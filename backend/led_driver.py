import logging
import os
import threading
import time
from copy import deepcopy

from config import (
    DEFAULT_BRIGHTNESS,
    GRID_HEIGHT,
    GRID_WIDTH,
    LED_COUNT,
    LED_DMA,
    LED_FREQ_HZ,
    LED_HARDWARE_MODE,
    LED_INVERT,
    LED_PIN,
)


logger = logging.getLogger(__name__)

frame_buffer = [[0, 0, 0] for _ in range(LED_COUNT)]

_lock = threading.Lock()
_strip = None
_hardware_enabled = False
_hardware_status = "not_started"
_hardware_reason = ""
_brightness = DEFAULT_BRIGHTNESS
_driver_thread = None


def xy_to_index(x, y):
    if y % 2 == 0:
        return y * GRID_WIDTH + x
    return y * GRID_WIDTH + (GRID_WIDTH - 1 - x)


def _looks_like_raspberry_pi():
    model_paths = ("/proc/device-tree/model", "/sys/firmware/devicetree/base/model")
    for path in model_paths:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as file:
                if "raspberry pi" in file.read().lower():
                    return True
        except OSError:
            continue

    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8", errors="ignore") as file:
            return "raspberry pi" in file.read().lower()
    except OSError:
        return False


def _should_try_hardware():
    if LED_HARDWARE_MODE in {"sim", "simulation", "off", "false", "0"}:
        return False, "hardware disabled by LED_HARDWARE_MODE"

    if LED_HARDWARE_MODE in {"force", "on", "true", "1"}:
        return True, "hardware forced by LED_HARDWARE_MODE"

    if LED_HARDWARE_MODE != "auto":
        return False, f"unknown LED_HARDWARE_MODE={LED_HARDWARE_MODE!r}; using simulation"

    if _looks_like_raspberry_pi():
        return True, "raspberry pi detected"

    return False, "not running on a raspberry pi"


def _init_hardware():
    global _hardware_enabled, _hardware_reason, _hardware_status, _strip

    should_try, reason = _should_try_hardware()
    if not should_try:
        _hardware_status = "simulation"
        _hardware_reason = reason
        logger.info("LED hardware not enabled: %s", reason)
        return None

    try:
        from rpi_ws281x import PixelStrip

        strip = PixelStrip(
            LED_COUNT,
            LED_PIN,
            LED_FREQ_HZ,
            LED_DMA,
            LED_INVERT,
            _brightness,
        )
        strip.begin()
    except Exception as exc:
        _hardware_enabled = False
        _hardware_status = "simulation"
        _hardware_reason = f"hardware init failed: {exc}"
        logger.warning("LED hardware unavailable; running in simulation mode: %s", exc)
        return None

    _strip = strip
    _hardware_enabled = True
    _hardware_status = "hardware"
    _hardware_reason = reason
    logger.info("LED hardware enabled: %s", reason)
    return strip


def _driver_loop():
    strip = _init_hardware()
    if strip is None:
        return

    from rpi_ws281x import Color

    while True:
        with _lock:
            pixels = deepcopy(frame_buffer)

        for i, (r, g, b) in enumerate(pixels):
            strip.setPixelColor(i, Color(int(r), int(g), int(b)))
        strip.show()
        time.sleep(1 / 30)


def start_driver():
    global _driver_thread

    if _driver_thread is not None and _driver_thread.is_alive():
        return _driver_thread

    thread = threading.Thread(target=_driver_loop, name="led-driver", daemon=True)
    thread.start()
    _driver_thread = thread
    return thread


def _clamp_channel(value):
    return max(0, min(255, int(value)))


def set_pixel(x, y, r, g, b):
    if not 0 <= x < GRID_WIDTH or not 0 <= y < GRID_HEIGHT:
        raise ValueError(f"pixel out of bounds: ({x}, {y})")

    pixel = [_clamp_channel(r), _clamp_channel(g), _clamp_channel(b)]
    with _lock:
        frame_buffer[xy_to_index(x, y)] = pixel


def set_frame(pixels):
    if len(pixels) != LED_COUNT:
        raise ValueError(f"expected {LED_COUNT} pixels, got {len(pixels)}")

    normalized = [[_clamp_channel(c) for c in pixel[:3]] for pixel in pixels]
    physical = [[0, 0, 0] for _ in range(LED_COUNT)]
    for y in range(GRID_HEIGHT):
        for x in range(GRID_WIDTH):
            physical[xy_to_index(x, y)] = normalized[y * GRID_WIDTH + x]

    with _lock:
        frame_buffer[:] = physical


def get_frame():
    with _lock:
        physical = deepcopy(frame_buffer)

    row_major = []
    for y in range(GRID_HEIGHT):
        for x in range(GRID_WIDTH):
            row_major.append(physical[xy_to_index(x, y)])
    return row_major


def set_brightness(brightness):
    global _brightness

    _brightness = _clamp_channel(brightness)
    if _hardware_enabled and _strip is not None:
        _strip.setBrightness(_brightness)


def get_status():
    return {
        "mode": LED_HARDWARE_MODE,
        "status": _hardware_status,
        "reason": _hardware_reason,
        "hardware_enabled": _hardware_enabled,
        "brightness": _brightness,
        "pid": os.getpid(),
    }
