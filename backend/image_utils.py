from io import BytesIO

from PIL import Image, ImageOps, ImageSequence

from config import GRID_HEIGHT, GRID_WIDTH


ALLOWED_TYPES = {
    "image/png": ("PNG", "image"),
    "image/jpeg": ("JPEG", "image"),
    "image/jpg": ("JPEG", "image"),
    "image/gif": ("GIF", "gif"),
}


def _fit_size(width, height):
    if width <= GRID_WIDTH and height <= GRID_HEIGHT:
        return width, height

    scale = min(GRID_WIDTH / width, GRID_HEIGHT / height)
    return max(1, int(width * scale)), max(1, int(height * scale))


def _normalized_rgba(image):
    return ImageOps.exif_transpose(image).convert("RGBA")


def _flatten_on_black(image):
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    background.alpha_composite(rgba)
    return background.convert("RGB")


def process_upload(file_bytes, content_type):
    normalized_type = (content_type or "").split(";")[0].strip().lower()
    if normalized_type not in ALLOWED_TYPES:
        raise ValueError("Only PNG, JPG, and GIF files are supported.")

    output_format, image_type = ALLOWED_TYPES[normalized_type]

    with Image.open(BytesIO(file_bytes)) as image:
        if image_type == "gif":
            frames = []
            durations = []
            first_size = None

            for frame in ImageSequence.Iterator(image):
                normalized = frame.convert("RGBA")
                width, height = _fit_size(*normalized.size)
                if normalized.size != (width, height):
                    normalized = normalized.resize((width, height), Image.Resampling.NEAREST)
                normalized = _flatten_on_black(normalized)
                if first_size is None:
                    first_size = normalized.size
                elif normalized.size != first_size:
                    canvas = Image.new("RGB", first_size, (0, 0, 0))
                    canvas.paste(normalized, (0, 0))
                    normalized = canvas
                frames.append(normalized)
                durations.append(frame.info.get("duration", image.info.get("duration", 100)))

            if not frames:
                raise ValueError("GIF has no frames.")

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
            width, height = frames[0].size
            return output.getvalue(), width, height

        normalized = _normalized_rgba(image)
        width, height = _fit_size(*normalized.size)
        if normalized.size != (width, height):
            normalized = normalized.resize((width, height), Image.Resampling.NEAREST)
        normalized = _flatten_on_black(normalized)

        output = BytesIO()
        if output_format == "JPEG":
            normalized.save(output, format=output_format)
        else:
            normalized.save(output, format=output_format)
        return output.getvalue(), width, height


def image_to_pixels(image):
    normalized = _flatten_on_black(image)
    pixels = [[0, 0, 0] for _ in range(GRID_WIDTH * GRID_HEIGHT)]
    x_offset = (GRID_WIDTH - normalized.width) // 2
    y_offset = (GRID_HEIGHT - normalized.height) // 2

    for y in range(normalized.height):
        for x in range(normalized.width):
            r, g, b = normalized.getpixel((x, y))
            rgb = [r, g, b]
            target = (y + y_offset) * GRID_WIDTH + (x + x_offset)
            pixels[target] = rgb

    return pixels
