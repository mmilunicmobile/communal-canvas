import asyncio
import os
import subprocess
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageSequence

import database
from config import (
    GRID_HEIGHT,
    GRID_WIDTH,
    IMAGES_DIR,
    PASSKEY,
    STATIC_DIR,
)
from image_utils import image_to_pixels, process_upload
from led_driver import (
    get_frame,
    get_status,
    set_brightness,
    set_frame,
    set_pixel,
    start_driver,
)


@asynccontextmanager
async def lifespan(app):
    os.makedirs(IMAGES_DIR, exist_ok=True)
    os.makedirs(STATIC_DIR, exist_ok=True)
    database.init_db()
    start_driver()
    yield


app = FastAPI(lifespan=lifespan)
connections = set()
connections_lock = asyncio.Lock()
animation_task = None
os.makedirs(STATIC_DIR, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_admin(authorization: str = Header(None)):
    if authorization != f"Bearer {PASSKEY}":
        raise HTTPException(status_code=403, detail="Admin passkey required.")


def image_path(record):
    return Path(IMAGES_DIR) / record["filename"]


def pixel_messages_from_frame(pixels):
    for y in range(GRID_HEIGHT):
        for x in range(GRID_WIDTH):
            r, g, b = pixels[y * GRID_WIDTH + x]
            yield {"x": x, "y": y, "r": r, "g": g, "b": b}


async def broadcast_pixel(message):
    async with connections_lock:
        targets = list(connections)

    results = await asyncio.gather(
        *(_send_pixel(websocket, message) for websocket in targets),
        return_exceptions=True,
    )
    dead = [
        websocket
        for websocket, result in zip(targets, results)
        if result is False or isinstance(result, Exception)
    ]

    if dead:
        async with connections_lock:
            for websocket in dead:
                connections.discard(websocket)


async def _send_pixel(websocket, message):
    try:
        await asyncio.wait_for(websocket.send_json(message), timeout=1)
        return True
    except Exception:
        return False


async def broadcast_frame(pixels):
    for message in pixel_messages_from_frame(pixels):
        await broadcast_pixel(message)


def cancel_animation():
    global animation_task

    if animation_task is not None and not animation_task.done():
        animation_task.cancel()
    animation_task = None


async def play_gif(path):
    try:
        while True:
            with Image.open(path) as image:
                for frame in ImageSequence.Iterator(image):
                    pixels = image_to_pixels(frame)
                    set_frame(pixels)
                    await broadcast_frame(pixels)
                    delay = max(20, int(frame.info.get("duration", 100)))
                    await asyncio.sleep(delay / 1000)
    except asyncio.CancelledError:
        raise


@app.get("/api/frame")
def read_frame():
    return {"pixels": get_frame()}


@app.get("/api/hardware")
def read_hardware():
    return get_status()


@app.post("/api/brightness", dependencies=[Depends(require_admin)])
async def update_brightness(payload: dict):
    brightness = payload.get("brightness")
    if brightness is None:
        raise HTTPException(status_code=422, detail="brightness is required.")
    set_brightness(brightness)
    return {"brightness": int(brightness)}


@app.post("/api/clear", dependencies=[Depends(require_admin)])
async def clear():
    cancel_animation()
    pixels = [[0, 0, 0] for _ in range(GRID_WIDTH * GRID_HEIGHT)]
    set_frame(pixels)
    await broadcast_frame(pixels)
    return {"pixels": pixels}


@app.get("/api/images")
def list_images():
    return database.list_images()


@app.get("/api/images/{image_id}/file")
def read_image_file(image_id: int):
    record = database.get_image(image_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    path = image_path(record)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file not found.")
    return FileResponse(path)


@app.post("/api/images/upload")
async def upload_image(file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        processed, width, height = process_upload(file_bytes, file.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ext = ".gif" if file.content_type == "image/gif" else ".png"
    if file.content_type in {"image/jpeg", "image/jpg"}:
        ext = ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    path = Path(IMAGES_DIR) / filename
    path.write_bytes(processed)

    image_type = "gif" if file.content_type == "image/gif" else "image"
    return database.create_image(filename, file.filename or filename, image_type, width, height)


@app.post("/api/images/{image_id}/display")
async def display_image(image_id: int):
    global animation_task

    record = database.get_image(image_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Image not found.")

    path = image_path(record)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file not found.")

    cancel_animation()
    if record["type"] == "gif":
        animation_task = asyncio.create_task(play_gif(path))
        return {"status": "animating", "id": image_id}

    with Image.open(path) as image:
        pixels = image_to_pixels(image)
    set_frame(pixels)
    await broadcast_frame(pixels)
    return {"status": "displayed", "id": image_id}


@app.delete("/api/images/{image_id}", dependencies=[Depends(require_admin)])
def delete_image(image_id: int):
    record = database.delete_image(image_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    path = image_path(record)
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    return record


@app.post("/api/deploy", dependencies=[Depends(require_admin)])
def deploy():
    subprocess.Popen(["bash", "../deploy.sh"])
    return {"status": "deploying"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with connections_lock:
        connections.add(websocket)

    try:
        for message in pixel_messages_from_frame(get_frame()):
            await _send_pixel(websocket, message)

        while True:
            message = await websocket.receive_json()
            x = int(message["x"])
            y = int(message["y"])
            r = int(message["r"])
            g = int(message["g"])
            b = int(message["b"])
            set_pixel(x, y, r, g, b)
            await broadcast_pixel({"x": x, "y": y, "r": r, "g": g, "b": b})
    except WebSocketDisconnect:
        pass
    finally:
        async with connections_lock:
            connections.discard(websocket)


# Static files must stay last so API and WebSocket routes win first.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
