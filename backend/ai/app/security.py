"""Shared-secret check: only the main backend may call the inference endpoint."""

import hmac
from collections.abc import Callable
from typing import Annotated

from fastapi import Header

from .errors import ServiceError

SECRET_HEADER = "X-AI-Service-Key"


def require_service_key(expected: str) -> Callable[[str | None], None]:
    expected_bytes = expected.encode("utf-8")

    def dependency(x_ai_service_key: Annotated[str | None, Header(alias=SECRET_HEADER)] = None) -> None:
        provided = (x_ai_service_key or "").encode("utf-8")
        # Constant-time comparison so the secret cannot be guessed byte by byte.
        if not hmac.compare_digest(provided, expected_bytes):
            raise ServiceError(401, "UNAUTHORIZED", "Missing or invalid service key.")

    return dependency
