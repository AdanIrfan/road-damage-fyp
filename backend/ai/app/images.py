"""Decoding of uploaded images. Anything that is not a valid JPEG/PNG is rejected."""

import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import ServiceError

ALLOWED_FORMATS = {"JPEG", "PNG"}


def decode_image(data: bytes, max_pixels: int) -> Image.Image:
    """Returns an RGB image with EXIF orientation applied, so boxes match what people see."""
    if not data:
        raise ServiceError(400, "INVALID_IMAGE", "The image is empty.")
    try:
        with warnings.catch_warnings():
            # Pillow only warns between 1x and 2x its own limit; treat oversize as an error.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data))
            if image.format not in ALLOWED_FORMATS:
                raise ServiceError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG and PNG images are supported.")
            width, height = image.size
            if width * height > max_pixels:
                raise ServiceError(413, "IMAGE_TOO_LARGE", "The image has too many pixels.")
            image.load()
            image = ImageOps.exif_transpose(image)
            return image.convert("RGB")
    except ServiceError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ServiceError(400, "INVALID_IMAGE", "The file is not a valid image.") from exc
