"""The YOLOv8 detector. The model is loaded ONCE when the service starts.

Ultralytics (and PyTorch) are imported only inside YoloDetector, so tests that use a fake
detector do not need the model file or the heavy libraries.
"""

import os
from pathlib import Path
from typing import Protocol

from PIL import Image

from .schemas import Box, Detection, ModelInfo


class ModelLoadError(RuntimeError):
    """The model could not be loaded. The service must not start (no fake predictions)."""


class Detector(Protocol):
    @property
    def info(self) -> ModelInfo: ...

    def predict(self, image: Image.Image, confidence: float, iou: float) -> list[Detection]: ...


class YoloDetector:
    def __init__(self, model_path: Path, image_size: int, device: str) -> None:
        if not model_path.is_file():
            raise ModelLoadError(
                f"Model weights not found at {model_path}. Put the trained best.pt there or set AI_MODEL_PATH."
            )
        # Stop Ultralytics from contacting the internet (update checks, analytics).
        os.environ.setdefault("YOLO_OFFLINE", "1")
        try:
            from ultralytics import YOLO

            self._model = YOLO(str(model_path))
        except Exception as exc:  # noqa: BLE001 - any failure here must stop startup with a clear message
            raise ModelLoadError(f"Could not load the model from {model_path}: {exc}") from exc

        if self._model.task != "detect":
            raise ModelLoadError(f"Expected a detection model, got task '{self._model.task}'.")
        names = self._model.names
        # Class names come from the model file itself, never from a hard-coded list.
        classes = [str(names[index]) for index in sorted(names)]
        self._info = ModelInfo(name=model_path.stem, task=str(self._model.task), classes=classes)
        self._image_size = image_size
        self._device = device

    @property
    def info(self) -> ModelInfo:
        return self._info

    def predict(self, image: Image.Image, confidence: float, iou: float) -> list[Detection]:
        """Blocking: call it from a worker thread, never directly on the event loop."""
        result = self._model.predict(
            image, imgsz=self._image_size, conf=confidence, iou=iou, device=self._device, verbose=False
        )[0]
        detections: list[Detection] = []
        for box in result.boxes:
            class_id = int(box.cls.item())
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            detections.append(
                Detection(
                    class_id=class_id,
                    class_name=self._info.classes[class_id],
                    confidence=float(box.conf.item()),
                    box=Box(x1=x1, y1=y1, x2=x2, y2=y2),
                )
            )
        return detections

    def warm_up(self) -> None:
        """Runs one inference on a blank image so the first real request is not slow."""
        self.predict(Image.new("RGB", (self._image_size, self._image_size)), 0.99, 0.7)
