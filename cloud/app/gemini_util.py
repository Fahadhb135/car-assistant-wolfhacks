"""Gemini calls fail transiently (503 under load, 429) and models get retired (404).
Retry briefly, then fall through to the next model."""
import time
from typing import Callable, Optional, Sequence

RETRYABLE = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "DEADLINE")


def call_with_fallback(
    models: Sequence[str],
    fn: Callable[[str], Optional[str]],
    attempts: int = 2,
    delay: float = 0.6,
    sleep: Callable[[float], None] = time.sleep,
) -> Optional[str]:
    last: Optional[Exception] = None
    for model in models:
        for attempt in range(attempts):
            try:
                return fn(model)
            except Exception as exc:  # SDK raises several error types
                last = exc
                if not any(tag in str(exc) for tag in RETRYABLE):
                    break  # e.g. 404 retired model: try the next one now
                if attempt + 1 < attempts:
                    sleep(delay)
    if last is not None:
        raise last
    return None
