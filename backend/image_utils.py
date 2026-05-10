from io import BytesIO
from typing import Tuple

from PIL import Image, ImageOps, ImageSequence

from constants import GRID_HEIGHT, GRID_WIDTH


ALLOWED_TYPES = {
    "image/png": "image",
    "image/jpeg": "image",
    "image/jpg": "image",
    "image/gif": "gif",
}


def _flatten_on_black(image: Image.Image) -> Image.Image:
    """Composite an image with alpha channel onto a black background.
    
    Args:
        image: PIL Image object (typically RGBA)
    
    Returns:
        RGB image with alpha channel composited onto black background
    """
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    background.alpha_composite(rgba)
    return background.convert("RGB")


def _resize_and_pad_to_grid(image: Image.Image) -> Image.Image:
    """Resize and center an image to fill the LED grid with black padding.
    
    If the image is larger than the grid, it's scaled down using high-quality
    interpolation while maintaining aspect ratio. The result is then centered
    on a black background to reach exactly GRID_WIDTH x GRID_HEIGHT dimensions.
    
    Args:
        image: RGB or RGBA PIL Image object
    
    Returns:
        RGB image of exactly GRID_WIDTH x GRID_HEIGHT dimensions
    """
    # Handle alpha channel first
    if image.mode == "RGBA" or image.mode == "LA" or "transparency" in image.info:
        image = _flatten_on_black(image)
    else:
        image = image.convert("RGB")
    
    # If image is smaller than grid, just pad it
    if image.width <= GRID_WIDTH and image.height <= GRID_HEIGHT:
        canvas = Image.new("RGB", (GRID_WIDTH, GRID_HEIGHT), (0, 0, 0))
        x_offset = (GRID_WIDTH - image.width) // 2
        y_offset = (GRID_HEIGHT - image.height) // 2
        canvas.paste(image, (x_offset, y_offset))
        return canvas
    
    # If image is larger, scale down while maintaining aspect ratio
    # Calculate scale to fit within grid
    scale = min(GRID_WIDTH / image.width, GRID_HEIGHT / image.height)
    new_width = max(1, int(image.width * scale))
    new_height = max(1, int(image.height * scale))
    
    # Use LANCZOS for high-quality downsampling
    image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
    
    # Center the scaled image on black background
    canvas = Image.new("RGB", (GRID_WIDTH, GRID_HEIGHT), (0, 0, 0))
    x_offset = (GRID_WIDTH - new_width) // 2
    y_offset = (GRID_HEIGHT - new_height) // 2
    canvas.paste(image, (x_offset, y_offset))
    return canvas


def process_upload(file_bytes: bytes, content_type : str | None) -> Tuple[bytes, str]:
    """Process an uploaded image file for display on the LED grid.
    
    Handles PNG, JPEG, JPG, and GIF formats. Images are:
    1. Scaled down (if needed) using high-quality interpolation
    2. Alpha channels (if present) are composited onto black background
    3. Centered with black padding to reach exactly GRID_WIDTH x GRID_HEIGHT
    4. Returned as a bytestream with no alpha channel
    
    Args:
        file_bytes: Raw image file bytes
        content_type: MIME type of the image (e.g., "image/png")
    
    Returns:
        Tuple of (image_bytestream, file_extension) ready to be saved
        
    Raises:
        ValueError: If the image format is not supported or file is invalid
    """
    normalized_type = (content_type or "").split(";")[0].strip().lower()
    if normalized_type not in ALLOWED_TYPES:
        raise ValueError("Only PNG, JPG, and GIF files are supported.")

    image_type = ALLOWED_TYPES[normalized_type]

    with Image.open(BytesIO(file_bytes)) as image:
        # Apply EXIF orientation
        image = ImageOps.exif_transpose(image)
        
        if image_type == "gif":
            frames = []
            durations = []

            for frame in ImageSequence.Iterator(image):
                # Resize and pad each frame
                processed_frame = _resize_and_pad_to_grid(frame)
                frames.append(processed_frame)
                durations.append(frame.info.get("duration", image.info.get("duration", 100)))

            if not frames:
                raise ValueError("GIF has no frames.")

            # Save as GIF with all frames
            output = BytesIO()
            frames[0].save(
                output,
                format="GIF",
                save_all=True,
                append_images=frames[1:],
                duration=durations,
                loop=0,
                disposal=2,
            )
            output.seek(0)
            return output.getvalue(), "gif"

        # Process static image (PNG, JPG)
        processed_image = _resize_and_pad_to_grid(image)
        
        output = BytesIO()
        processed_image.save(output, format="PNG")
        output.seek(0)
        return output.getvalue(), "png"


def image_to_pixels(image: Image.Image) -> list[list[Tuple[int, int, int]]]:
    """Convert an image to a 2D array of RGB pixel values.
    
    Args:
        image: PIL Image object (will be converted to RGB if needed)
    
    Returns:
        2D list of (R, G, B) tuples representing pixel values
    """
    # Ensure image is in RGB mode
    if image.mode != "RGB":
        image = image.convert("RGB")
    
    width, height = image.size
    pixels = image.getdata()
    
    # Convert to 2D array (row-major order: [y][x])
    pixel_array = []
    for y in range(height):
        row = []
        for x in range(width):
            row.append(pixels[y * width + x])
        pixel_array.append(row)
    
    return pixel_array
