import asyncio
import os
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
from PIL import Image

import database
from constants import (
    GRID_HEIGHT,
    GRID_WIDTH,
    PASSKEY,
)
from image_utils import image_to_pixels, iter_rendered_gif_frames, process_upload
from led_driver import (
    set_brightness,
    set_frame,
    set_pixel,
    flush_pixels,
    init_driver,
    cleanup_driver
)

pixels = [[(0, 0, 0) for _ in range(GRID_WIDTH)] for _ in range(GRID_HEIGHT)]
os.makedirs("images", exist_ok=True)
os.makedirs("static", exist_ok=True)
    
@asynccontextmanager
async def lifespan(app):
    os.makedirs("images", exist_ok=True)
    os.makedirs("static", exist_ok=True)
    database.init_db()
    init_driver()
    yield
    cleanup_driver()

app = FastAPI(lifespan=lifespan)
connections = set()
connections_lock = asyncio.Lock()
animation_task = None
pixels_lock = asyncio.Lock()
gif_protected_pixels = set()
active_gif_id = None

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
    return Path("images") / record["filename"]


def pixel_messages_from_frame(pixels):
    for y in range(GRID_HEIGHT):
        for x in range(GRID_WIDTH):
            r, g, b = pixels[y][x]
            yield {"x": x, "y": y, "r": r, "g": g, "b": b}


def pixel_messages_from_diff(previous_pixels, next_pixels):
    for y in range(GRID_HEIGHT):
        for x in range(GRID_WIDTH):
            if previous_pixels[y][x] == next_pixels[y][x]:
                continue
            r, g, b = next_pixels[y][x]
            yield {"x": x, "y": y, "r": r, "g": g, "b": b}


async def broadcast_pixel(messages):
    if not messages:
        return

    async with connections_lock:
        targets = list(connections)

    results = await asyncio.gather(
        *(_send_pixel(websocket, messages) for websocket in targets),
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


async def _send_pixel(websocket, messages):
    try:
        await asyncio.wait_for(websocket.send_json(messages), timeout=1)
        return True
    except Exception:
        return False

async def write_frame(pixels):
    await asyncio.to_thread(set_frame, pixels)
    await asyncio.to_thread(flush_pixels)

async def broadcast_frame(pixels):
    await broadcast_pixel(list(pixel_messages_from_frame(pixels)))


def cancel_animation():
    global animation_task

    if animation_task is not None and not animation_task.done():
        animation_task.cancel()
    animation_task = None


def reset_gif_protection():
    global active_gif_id

    gif_protected_pixels.clear()
    active_gif_id = None


async def set_static_pixels(new_pixels):
    global pixels

    async with pixels_lock:
        pixels = [row[:] for row in new_pixels]
        return [row[:] for row in pixels]


async def apply_gif_frame(frame_pixels, gif_id):
    global pixels

    async with pixels_lock:
        if active_gif_id != gif_id:
            raise asyncio.CancelledError

        previous_pixels = [row[:] for row in pixels]
        merged_pixels = [row[:] for row in frame_pixels]
        for x, y in gif_protected_pixels:
            merged_pixels[y][x] = pixels[y][x]

        pixels = merged_pixels
        return previous_pixels, [row[:] for row in pixels]


async def play_gif(path, gif_id):
    try:
        while True:
            with Image.open(path) as image:
                for frame_index, frame in enumerate(iter_rendered_gif_frames(image)):
                    frame_pixels = image_to_pixels(frame)
                    previous_pixels, pixels_to_show = await apply_gif_frame(frame_pixels, gif_id)
                    changed_pixels = list(pixel_messages_from_diff(previous_pixels, pixels_to_show))
                    await asyncio.gather(write_frame(pixels_to_show), broadcast_pixel(changed_pixels))
                    image.seek(frame_index)
                    delay = max(20, int(image.info.get("duration", 100)))
                    await asyncio.sleep(delay / 1000)
    except asyncio.CancelledError:
        raise

@app.post("/api/brightness", dependencies=[Depends(require_admin)])
async def update_brightness(payload: dict):
    brightness = payload.get("brightness")
    if brightness is None:
        raise HTTPException(status_code=422, detail="brightness is required.")
    await asyncio.to_thread(set_brightness, brightness)
    return {"brightness": int(brightness)}


@app.post("/api/clear", dependencies=[Depends(require_admin)])
async def clear():
    cancel_animation()
    reset_gif_protection()
    cleared_pixels = await set_static_pixels(
        [[(0, 0, 0) for _ in range(GRID_WIDTH)] for _ in range(GRID_HEIGHT)]
    )
    await asyncio.gather(write_frame(cleared_pixels), broadcast_frame(cleared_pixels))
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


@app.post("/api/images/upload", dependencies=[Depends(require_admin)])
async def upload_image(file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        processed, file_extension = await asyncio.to_thread(process_upload, file_bytes, file.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    filename = f"{uuid.uuid4().hex}.{file_extension}"
    path = Path("images") / filename
    await asyncio.to_thread(path.write_bytes, processed)

    image_type = "gif" if file_extension == "gif" else "image"
    return database.create_image(filename, file.filename or filename, image_type)


@app.post("/api/images/{image_id}/display", dependencies=[Depends(require_admin)])
async def display_image(image_id: int):
    global animation_task
    global active_gif_id

    record = database.get_image(image_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Image not found.")

    path = image_path(record)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file not found.")

    cancel_animation()
    if record["type"] == "gif":
        gif_protected_pixels.clear()
        active_gif_id = image_id
        animation_task = asyncio.create_task(play_gif(path, image_id))
        return {"status": "animating", "id": image_id}

    with Image.open(path) as image:
        reset_gif_protection()
        static_pixels = await set_static_pixels(image_to_pixels(image))
    
    await asyncio.gather(write_frame(static_pixels), broadcast_frame(static_pixels))
    return {"status": "displayed", "id": image_id}


@app.delete("/api/images/{image_id}", dependencies=[Depends(require_admin)])
async def delete_image(image_id: int):
    record = await asyncio.to_thread(database.delete_image, image_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    path = image_path(record)
    try:
        await asyncio.to_thread(path.unlink)
    except FileNotFoundError:
        pass
    return record


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with connections_lock:
        connections.add(websocket)

    try:
        
        await _send_pixel(websocket, list(pixel_messages_from_frame(pixels)))

        while True:
            message = await websocket.receive_json()
            x = int(message["x"])
            y = int(message["y"])
            r = int(message["r"])
            g = int(message["g"])
            b = int(message["b"])
            token = message.get("auth")
            if token != PASSKEY:
                continue

            async with pixels_lock:
                if active_gif_id is not None:
                    gif_protected_pixels.add((x, y))
                pixels[y][x] = (r, g, b)

            broadcast_task = asyncio.create_task(
                broadcast_pixel([{"x": x, "y": y, "r": r, "g": g, "b": b}])
            )
            await asyncio.to_thread(set_pixel, x, y, (r, g, b))
            await asyncio.to_thread(flush_pixels)
            await broadcast_task
            
    except WebSocketDisconnect:
        pass
    finally:
        async with connections_lock:
            connections.discard(websocket)


# Static files must stay last so API and WebSocket routes win first.
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
