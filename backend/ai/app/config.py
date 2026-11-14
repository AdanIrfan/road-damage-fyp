"""Configuration for the AI inference service, read from environment variables (prefix AI_).

Values come from the process environment first, then from backend/ai/.env (never committed).
Invalid configuration stops the service at startup with a list of problems (never the values).
"""

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: backend/ai/ — relative paths in the configuration are resolved from here.
SERVICE_ROOT = Path(__file__).resolve().parent.parent

PLACEHOLDER_SECRET = "CHANGE_ME"
MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=SERVICE_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    #: Trained YOLOv8 weights. Relative paths are resolved from backend/ai/.
    model_path: Path = Path("weights/best.pt")
    #: Shared secret the main backend sends in the X-AI-Service-Key header.
    shared_secret: str = Field(min_length=MIN_SECRET_LENGTH)
    #: Detections below this confidence are discarded (Ultralytics default 0.25).
    confidence_threshold: float = Field(default=0.25, ge=0.0, le=1.0)
    #: IoU threshold for non-maximum suppression (Ultralytics default 0.7).
    iou_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    #: Inference image size; the model was trained at 640.
    image_size: int = Field(default=640, ge=32, le=4096)
    #: Inference device. CPU is the agreed default.
    device: str = "cpu"
    #: Largest accepted upload (bytes).
    max_image_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    #: Largest accepted image (pixels), protects against decompression bombs.
    max_image_pixels: int = Field(default=8000 * 8000, ge=1)

    @field_validator("shared_secret")
    @classmethod
    def _secret_is_not_placeholder(cls, value: str) -> str:
        if PLACEHOLDER_SECRET in value:
            raise ValueError(f"still contains the placeholder {PLACEHOLDER_SECRET}; generate a real secret")
        return value

    @field_validator("model_path")
    @classmethod
    def _resolve_model_path(cls, value: Path) -> Path:
        return value if value.is_absolute() else SERVICE_ROOT / value
