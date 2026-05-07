import os


GRID_WIDTH = 20
GRID_HEIGHT = 15
LED_COUNT = GRID_WIDTH * GRID_HEIGHT

LED_PIN = 18
LED_FREQ_HZ = 800000
LED_DMA = 10
LED_INVERT = False
DEFAULT_BRIGHTNESS = 128

# auto: use hardware only when this machine looks like a Raspberry Pi.
# force: import and initialize rpi_ws281x regardless of host detection.
# sim: never import rpi_ws281x; keep the in-memory frame buffer only.
LED_HARDWARE_MODE = os.environ.get("LED_HARDWARE_MODE", "auto").strip().lower()

PASSKEY = os.environ.get("LED_PASSKEY", "changeme")
DB_PATH = "ledmatrix.db"
IMAGES_DIR = "images"
STATIC_DIR = "static"
