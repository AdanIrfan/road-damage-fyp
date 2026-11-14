"""Integration test with the real trained weights. Skipped (clearly reported) when best.pt is absent.

It checks that the model loads and produces well-formed output. It does NOT measure accuracy.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import SERVICE_ROOT
from app.main import create_app

from .conftest import SECRET, image_bytes, make_settings

WEIGHTS = SERVICE_ROOT / "weights" / "best.pt"

pytestmark = pytest.mark.skipif(not WEIGHTS.is_file(), reason=f"model weights not found at {WEIGHTS}")


def test_real_model_loads_and_runs_inference() -> None:
    with TestClient(create_app(make_settings(model_path=WEIGHTS))) as client:
        assert client.get("/health").json() == {"status": "ok", "model_loaded": True}
        res = client.post(
            "/v1/detect",
            files={"image": ("blank.jpg", image_bytes(size=(320, 240)), "image/jpeg")},
            headers={"X-AI-Service-Key": SECRET},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["model"]["task"] == "detect"
    # Class names as read from the model file (verified manually on 2026-11-14).
    assert body["model"]["classes"] == ["longitudinal_crack", "transverse_crack", "alligator_crack", "pothole"]
    assert body["image"] == {"width": 320, "height": 240}
    for detection in body["detections"]:
        assert detection["class_name"] in body["model"]["classes"]
        assert 0.25 <= detection["confidence"] <= 1
