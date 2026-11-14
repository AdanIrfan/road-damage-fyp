"""Response models of the inference API. The main backend validates these shapes again."""

from pydantic import BaseModel, Field


class Box(BaseModel):
    """Bounding box in pixels of the submitted image (after EXIF orientation is applied)."""

    x1: float
    y1: float
    x2: float
    y2: float


class Detection(BaseModel):
    class_id: int = Field(ge=0)
    class_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    box: Box


class ModelInfo(BaseModel):
    name: str
    task: str
    #: Class names read from the model file, indexed by class id.
    classes: list[str]


class ImageInfo(BaseModel):
    width: int
    height: int


class Thresholds(BaseModel):
    confidence: float
    iou: float


class DetectResponse(BaseModel):
    model: ModelInfo
    image: ImageInfo
    thresholds: Thresholds
    detections: list[Detection]
    inference_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
