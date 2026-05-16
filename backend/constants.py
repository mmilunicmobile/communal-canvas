GRID_WIDTH = 20
GRID_HEIGHT = 15
LED_COUNT = GRID_WIDTH * GRID_HEIGHT

LED_PIN = 12
DEFAULT_BRIGHTNESS = 0.2
PIXEL_ORDER = "GRB"

PASSKEY = "changeme"

DEFAULT_PERMISSION_SETTINGS = {
    "view_board": False,
    "draw_board": True,
    "clear_board": True,
    "list_images": False,
    "view_images": False,
    "upload_images": True,
    "display_images": True,
    "delete_images": True,
    "set_brightness": True,
    "run_commands": True,
}

USE_HARDWARE = False