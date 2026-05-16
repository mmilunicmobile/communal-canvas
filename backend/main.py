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
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

import database
from constants import (
    DEFAULT_BRIGHTNESS,
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
render_lock = asyncio.Lock()
gif_protected_pixels = set()
active_gif_id = None
current_brightness = DEFAULT_BRIGHTNESS

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


def token_is_admin(token):
    return token == PASSKEY


def authorization_token(authorization):
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def caller_can(feature, token):
    settings = database.list_permission_settings()
    requires_passkey = settings.get(feature, True)
    return not requires_passkey or token_is_admin(token)


def require_permission(feature):
    def dependency(request: Request, authorization: str = Header(None)):
        token = authorization_token(authorization) or request.query_params.get("auth")
        if not caller_can(feature, token):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"{feature.replace('_', ' ').title()} permission required.",
            )

    return dependency


def availability_for_token(token):
    settings = database.list_permission_settings()
    return {
        "passkey_valid": token_is_admin(token),
        "permissions": {
            feature: {
                "requires_passkey": requires_passkey,
                "available": not requires_passkey or token_is_admin(token),
            }
            for feature, requires_passkey in settings.items()
        },
    }


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
    async with render_lock:
        await asyncio.to_thread(set_frame, pixels)
        await asyncio.to_thread(flush_pixels)


def write_single_pixel(x, y, rgb):
    set_pixel(x, y, rgb)
    flush_pixels()

async def broadcast_frame(pixels):
    await broadcast_pixel(list(pixel_messages_from_frame(pixels)))


def parse_brightness_value(value):
    try:
        brightness = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("brightness must be a number.") from exc
    if brightness < 0 or brightness > 1:
        raise ValueError("brightness must be between 0 and 1.")
    return brightness


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
        with Image.open(path) as image:
            while True:
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

@app.post("/api/brightness", dependencies=[Depends(require_permission("set_brightness"))])
async def update_brightness(payload: dict):
    global current_brightness

    brightness = payload.get("brightness")
    if brightness is None:
        raise HTTPException(status_code=422, detail="brightness is required.")
    try:
        brightness = parse_brightness_value(brightness)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await asyncio.to_thread(set_brightness, brightness)
    current_brightness = brightness
    return {"brightness": brightness}


@app.get("/api/brightness", dependencies=[Depends(require_permission("view_board"))])
def get_brightness():
    return {"brightness": current_brightness}


@app.get("/api/permissions/settings", dependencies=[Depends(require_admin)])
def get_permission_settings():
    return {"permissions": database.list_permission_settings()}


@app.put("/api/permissions/settings", dependencies=[Depends(require_admin)])
def update_permission_settings(payload: dict):
    permissions = payload.get("permissions")
    if not isinstance(permissions, dict):
        raise HTTPException(status_code=422, detail="permissions object is required.")
    try:
        settings = database.update_permission_settings(permissions)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"permissions": settings}


@app.get("/api/permissions/availability")
def get_permission_availability(request: Request, authorization: str = Header(None)):
    token = authorization_token(authorization) or request.query_params.get("auth")
    return availability_for_token(token)


@app.post("/api/commands", dependencies=[Depends(require_permission("run_commands"))])
async def run_command(payload: dict):
    command = payload.get("command")
    if not isinstance(command, str) or not command.strip():
        raise HTTPException(status_code=422, detail="command is required.")

    normalized = command.strip().lower()
    if normalized == "rainbow":
        cancel_animation()
        reset_gif_protection()
        rainbow = []
        colors = [
            (255, 0, 0),
            (255, 127, 0),
            (255, 255, 0),
            (0, 255, 0),
            (0, 0, 255),
            (75, 0, 130),
            (148, 0, 211),
        ]
        for y in range(GRID_HEIGHT):
            rainbow.append([colors[(x + y) % len(colors)] for x in range(GRID_WIDTH)])
        pixels_to_show = await set_static_pixels(rainbow)
        await asyncio.gather(write_frame(pixels_to_show), broadcast_frame(pixels_to_show))
        return {"status": "ok", "message": "Rainbow displayed."}

    return {"status": "unknown", "message": f"Unknown command: {command.strip()}"}


@app.post("/api/clear", dependencies=[Depends(require_permission("clear_board"))])
async def clear():
    cancel_animation()
    reset_gif_protection()
    cleared_pixels = await set_static_pixels(
        [[(0, 0, 0) for _ in range(GRID_WIDTH)] for _ in range(GRID_HEIGHT)]
    )
    await asyncio.gather(write_frame(cleared_pixels), broadcast_frame(cleared_pixels))
    return {"pixels": pixels}


@app.get("/api/images", dependencies=[Depends(require_permission("list_images"))])
def list_images():
    return database.list_images()


@app.get("/api/images/{image_id}/file", dependencies=[Depends(require_permission("view_images"))])
def read_image_file(image_id: int):
    record = database.get_image(image_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Image not found.")
    path = image_path(record)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image file not found.")
    return FileResponse(path)


@app.post("/api/images/upload", dependencies=[Depends(require_permission("upload_images"))])
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


@app.post("/api/images/{image_id}/display", dependencies=[Depends(require_permission("display_images"))])
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


@app.delete("/api/images/{image_id}", dependencies=[Depends(require_permission("delete_images"))])
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
    token = websocket.query_params.get("auth") or None
    if not caller_can("view_board", token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    async with connections_lock:
        connections.add(websocket)

    try:
        
        await _send_pixel(websocket, list(pixel_messages_from_frame(pixels)))

        while True:
            message = await websocket.receive_json()
            message_token = message.get("auth")
            message_type = message.get("type", "pixel")

            if message_type == "brightness":
                global current_brightness
                if not caller_can("set_brightness", message_token):
                    continue
                try:
                    brightness = parse_brightness_value(message.get("brightness"))
                except ValueError:
                    continue
                await asyncio.to_thread(set_brightness, brightness)
                current_brightness = brightness
                continue

            x = int(message["x"])
            y = int(message["y"])
            r = int(message["r"])
            g = int(message["g"])
            b = int(message["b"])
            if not caller_can("draw_board", message_token):
                continue

            async with pixels_lock:
                if active_gif_id is not None:
                    gif_protected_pixels.add((x, y))
                pixels[y][x] = (r, g, b)

            broadcast_task = asyncio.create_task(
                broadcast_pixel([{"x": x, "y": y, "r": r, "g": g, "b": b}])
            )
            async with render_lock:
                await asyncio.to_thread(write_single_pixel, x, y, (r, g, b))
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
