import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app
from app.schemas import Box, Detection, ModelInfo

SECRET = "test-shared-secret-that-is-long-enough-0123456789"


class FakeDetector:
    """Returns fixed detections and records the thresholds it was called with."""

    def __init__(self, detections: list[Detection] | None = None) -> None:
        self.detections = detections or []
        self.calls: list[tuple[int, int, float, float]] = []

    @property
    def info(self) -> ModelInfo:
        return ModelInfo(name="fake", task="detect", classes=["longitudinal_crack", "transverse_crack", "alligator_crack", "pothole"])

    def predict(self, image: Image.Image, confidence: float, iou: float) -> list[Detection]:
        self.calls.append((image.width, image.height, confidence, iou))
        return self.detections


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {"shared_secret": SECRET, "model_path": Path("weights/best.pt")}
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def image_bytes(fmt: str = "JPEG", size: tuple[int, int] = (64, 48)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (90, 90, 90)).save(buffer, format=fmt)
    return buffer.getvalue()


@pytest.fixture
def fake_detector() -> FakeDetector:
    return FakeDetector(
        [Detection(class_id=3, class_name="pothole", confidence=0.69, box=Box(x1=1, y1=2, x2=30, y2=40))]
    )


@pytest.fixture
def client(fake_detector: FakeDetector) -> Iterator[TestClient]:
    with TestClient(create_app(make_settings(), fake_detector)) as test_client:
        yield test_client
