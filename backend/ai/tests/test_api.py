from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.detector import ModelLoadError, YoloDetector
from app.main import create_app

from .conftest import SECRET, FakeDetector, image_bytes, make_settings

HEADERS = {"X-AI-Service-Key": SECRET}


def post_image(client: TestClient, data: bytes, headers: dict[str, str] | None = None, name: str = "image"):
    return client.post("/v1/detect", files={name: ("photo.jpg", data, "image/jpeg")}, headers=HEADERS if headers is None else headers)


def test_health_needs_no_key_and_reveals_nothing_else(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "model_loaded": True}


@pytest.mark.parametrize("headers", [{}, {"X-AI-Service-Key": "wrong"}, {"X-AI-Service-Key": SECRET + "x"}])
def test_detect_rejects_missing_or_wrong_key(client: TestClient, fake_detector: FakeDetector, headers: dict[str, str]) -> None:
    res = post_image(client, image_bytes(), headers)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"
    assert fake_detector.calls == []


def test_detect_returns_detections_model_info_and_thresholds(client: TestClient, fake_detector: FakeDetector) -> None:
    res = post_image(client, image_bytes(size=(64, 48)))
    assert res.status_code == 200
    body = res.json()
    assert body["model"] == {"name": "fake", "task": "detect", "classes": ["longitudinal_crack", "transverse_crack", "alligator_crack", "pothole"]}
    assert body["image"] == {"width": 64, "height": 48}
    assert body["thresholds"] == {"confidence": 0.25, "iou": 0.7}
    assert body["detections"] == [
        {"class_id": 3, "class_name": "pothole", "confidence": 0.69, "box": {"x1": 1.0, "y1": 2.0, "x2": 30.0, "y2": 40.0}}
    ]
    assert isinstance(body["inference_ms"], float)
    assert fake_detector.calls == [(64, 48, 0.25, 0.7)]


def test_thresholds_come_from_configuration(fake_detector: FakeDetector) -> None:
    app = create_app(make_settings(confidence_threshold=0.4, iou_threshold=0.5), fake_detector)
    with TestClient(app) as client:
        res = post_image(client, image_bytes())
    assert res.json()["thresholds"] == {"confidence": 0.4, "iou": 0.5}
    assert fake_detector.calls[0][2:] == (0.4, 0.5)


def test_png_is_accepted(client: TestClient) -> None:
    assert post_image(client, image_bytes("PNG")).status_code == 200


def test_non_image_is_rejected(client: TestClient, fake_detector: FakeDetector) -> None:
    res = post_image(client, b"definitely not an image")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_IMAGE"
    assert fake_detector.calls == []


def test_other_image_formats_are_rejected(client: TestClient) -> None:
    res = post_image(client, image_bytes("GIF"))
    assert res.status_code == 415
    assert res.json()["error"]["code"] == "UNSUPPORTED_IMAGE_TYPE"


def test_missing_image_field_is_rejected(client: TestClient) -> None:
    assert post_image(client, image_bytes(), name="file").status_code == 400
    res = client.post("/v1/detect", json={"image": "x"}, headers=HEADERS)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_REQUEST"


def test_too_large_image_is_rejected(fake_detector: FakeDetector) -> None:
    with TestClient(create_app(make_settings(max_image_bytes=2048), fake_detector)) as client:
        res = post_image(client, image_bytes(size=(400, 400)) + b"\0" * 4096)
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "IMAGE_TOO_LARGE"
    assert fake_detector.calls == []


def test_too_many_pixels_is_rejected(fake_detector: FakeDetector) -> None:
    with TestClient(create_app(make_settings(max_image_pixels=100), fake_detector)) as client:
        res = post_image(client, image_bytes(size=(20, 20)))
    assert res.status_code == 413


def test_secret_is_required_and_validated() -> None:
    with pytest.raises(ValidationError):
        make_settings(shared_secret="short")
    with pytest.raises(ValidationError):
        make_settings(shared_secret="CHANGE_ME_" + "x" * 40)


def test_missing_weights_fail_with_a_clear_error(tmp_path: Path) -> None:
    missing = tmp_path / "missing.pt"
    with pytest.raises(ModelLoadError, match="Model weights not found"):
        YoloDetector(missing, 640, "cpu")
