"""FastAPI application: AI inference only (no users, reports or database).

Run (from backend/ai/):
    .venv/bin/uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio
from fastapi import Depends, FastAPI, Request
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from .config import Settings
from .detector import Detector, YoloDetector
from .errors import ServiceError, register_error_handlers
from .images import decode_image
from .schemas import DetectResponse, ErrorResponse, HealthResponse, ImageInfo, Thresholds
from .security import require_service_key

# uvicorn configures this logger, so startup messages appear in the server output.
logger = logging.getLogger("uvicorn.error")

#: Room for multipart boundaries and headers on top of the image itself.
MULTIPART_OVERHEAD_BYTES = 64 * 1024


def load_settings() -> Settings:
    """Reads settings; on errors prints field names and reasons only (never the values)."""
    try:
        return Settings()  # type: ignore[call-arg]  # values come from the environment
    except ValidationError as exc:
        problems = [f"AI_{'.'.join(str(p) for p in e['loc']).upper()}: {e['msg']}" for e in exc.errors()]
        raise SystemExit("Invalid AI service configuration:\n  - " + "\n  - ".join(problems)) from None


def create_app(settings: Settings | None = None, detector: Detector | None = None) -> FastAPI:
    settings = settings or load_settings()
    check_key = require_service_key(settings.shared_secret)
    # Ultralytics models are not safe to call from several threads at once.
    inference_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if detector is not None:
            app.state.detector = detector
        else:
            # Loaded once at startup. A missing or broken model stops the service (no fake results).
            loaded = await anyio.to_thread.run_sync(
                lambda: YoloDetector(settings.model_path, settings.image_size, settings.device)
            )
            await anyio.to_thread.run_sync(loaded.warm_up)
            logger.info("Model loaded: %s classes=%s", loaded.info.name, loaded.info.classes)
            app.state.detector = loaded
        yield
        app.state.detector = None

    app = FastAPI(
        title="Road damage AI service",
        description="Internal inference service. Called only by the main backend.",
        version="1.0.0",
        lifespan=lifespan,
    )
    register_error_handlers(app)

    @app.get("/health", response_model=HealthResponse)
    async def health(request: Request) -> HealthResponse:
        return HealthResponse(status="ok", model_loaded=getattr(request.app.state, "detector", None) is not None)

    @app.post(
        "/v1/detect",
        response_model=DetectResponse,
        dependencies=[Depends(check_key)],
        responses={code: {"model": ErrorResponse} for code in (400, 401, 413, 415, 503)},
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    "multipart/form-data": {
                        "schema": {
                            "type": "object",
                            "required": ["image"],
                            "properties": {"image": {"type": "string", "format": "binary"}},
                        }
                    }
                },
            }
        },
    )
    async def detect(request: Request) -> DetectResponse:
        # The body is parsed here, AFTER the service key was checked by the dependency above.
        current: Detector | None = getattr(request.app.state, "detector", None)
        if current is None:
            raise ServiceError(503, "MODEL_NOT_LOADED", "The model is not loaded.")

        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > settings.max_image_bytes + MULTIPART_OVERHEAD_BYTES:
            raise ServiceError(413, "IMAGE_TOO_LARGE", "The image is too large.")

        data = await _read_image_field(request, settings.max_image_bytes)
        image = await anyio.to_thread.run_sync(decode_image, data, settings.max_image_pixels)

        started = time.perf_counter()
        async with inference_lock:
            detections = await anyio.to_thread.run_sync(
                current.predict, image, settings.confidence_threshold, settings.iou_threshold
            )
        elapsed_ms = (time.perf_counter() - started) * 1000

        return DetectResponse(
            model=current.info,
            image=ImageInfo(width=image.width, height=image.height),
            thresholds=Thresholds(confidence=settings.confidence_threshold, iou=settings.iou_threshold),
            detections=detections,
            inference_ms=round(elapsed_ms, 1),
        )

    return app


async def _read_image_field(request: Request, max_bytes: int) -> bytes:
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise ServiceError(400, "INVALID_REQUEST", "Send the image as multipart field 'image'.")
    try:
        form = await request.form(max_files=1, max_fields=1)
    except Exception as exc:  # noqa: BLE001 - malformed multipart bodies of any kind
        raise ServiceError(400, "INVALID_REQUEST", "Send the image as multipart field 'image'.") from exc
    try:
        upload = form.get("image")
        if not isinstance(upload, UploadFile):
            raise ServiceError(400, "INVALID_REQUEST", "Send the image as multipart field 'image'.")
        data = await upload.read(max_bytes + 1)
    finally:
        await form.close()
    if len(data) > max_bytes:
        raise ServiceError(413, "IMAGE_TOO_LARGE", "The image is too large.")
    return data
