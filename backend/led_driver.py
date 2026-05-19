import threading
from pathlib import Path
from typing import Tuple
from constants import (
    DEFAULT_BRIGHTNESS,
    GRID_HEIGHT,
    GRID_WIDTH,
    LED_COUNT,
    LED_PIN,
    PIXEL_ORDER,
    USE_HARDWARE
)

from PIL import Image

# Type alias for RGB color tuples
RGBColor = Tuple[int, int, int]
SIM_PATH = Path(__file__).resolve().parent / "sim.png"
flush_lock = threading.Lock()

def init_driver() -> None:
    """Initialize the LED driver for hardware or simulation mode.
    
    If USE_HARDWARE is True, initializes the NeoPixel hardware driver.
    Otherwise, creates a simulated LED array in memory.
    """
    if USE_HARDWARE:
        global leds
        import neopixel # type: ignore
        import board #type: ignore
        leds = neopixel.NeoPixel(getattr(board, LED_PIN), LED_COUNT, brightness=DEFAULT_BRIGHTNESS, pixel_order=PIXEL_ORDER, auto_write=False)
        leds.fill((0,0,0))
    else:
        global leds_sim
        leds_sim = [(0,0,0) for _ in range(LED_COUNT)]
    flush_pixels()

def cleanup_driver() -> None:
    """Clean up the LED driver.
    
    For hardware mode, deinitializes the NeoPixel driver to free resources. Reccomended by Neopixel library."""
    if USE_HARDWARE:
        leds.deinit()

def xy_to_index(x: int, y: int) -> int:
    """Convert 2D grid coordinates to linear LED index.
    
    Uses a serpentine/boustrophedon pattern where even rows are indexed
    left-to-right and odd rows are indexed right-to-left.
    
    Args:
        x: X coordinate (0 to GRID_WIDTH - 1)
        y: Y coordinate (0 to GRID_HEIGHT - 1)
    
    Returns:
        Linear index into the LED array
    """
    if y % 2 == 0:
        return y * GRID_WIDTH + x
    return y * GRID_WIDTH + (GRID_WIDTH - 1 - x)

def set_pixel(x: int, y: int, rgb: RGBColor) -> None:
    """Set the color of a pixel at the given grid coordinates.
    
    Updates the hardware LED or simulation array. Changes are not immediately
    visible - call flush_pixels() to display the changes.
    
    Args:
        x: X coordinate (0 to GRID_WIDTH - 1)
        y: Y coordinate (0 to GRID_HEIGHT - 1)
        rgb: Color as (R, G, B) tuple with values 0-255
    """
    if x < 0 or y < 0 or x >= GRID_WIDTH or y >= GRID_HEIGHT:
        raise ValueError(f"Pixel coordinates out of bounds: ({x}, {y})")

    (r, g, b) = rgb

    if USE_HARDWARE:
        index = xy_to_index(x, y)
        leds[index] = (r, g, b)
    else:
        index = x + y * GRID_WIDTH # sim uses simple row-major order
        leds_sim[index] = (r, g, b)

def set_frame(pixels: list[list[RGBColor]]) -> None:
    """Set the entire LED grid to the given 2D array of pixels.
    
    Args:
        pixels: 2D list of (R, G, B) tuples representing pixel values
    """
    for y, pixel_row in enumerate(pixels):
        for x, pixel in enumerate(pixel_row):
            set_pixel(x, y, pixel)

def flush_pixels() -> None:
    """Display the current pixel state.
    
    For hardware mode, sends the buffered pixel data to the LED display.
    For simulation mode, saves the current state as 'sim.png'.
    """
    with flush_lock:
        if USE_HARDWARE:
            leds.show()
        else:
            img = Image.new("RGB", (GRID_WIDTH, GRID_HEIGHT))
            try:
                img.putdata(leds_sim)
                img.save(SIM_PATH)
            finally:
                img.close()

def set_brightness(brightness: float) -> None:
    """Set the global brightness level for all LEDs.
    
    Only has an effect in hardware mode. The brightness value should be
    between 0.0 (off) and 1.0 (full brightness).
    
    Args:
        brightness: Brightness level (0.0 to 1.0)
    """
    if USE_HARDWARE:
        leds.brightness = brightness
        leds.show()
