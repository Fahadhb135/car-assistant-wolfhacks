"""Gemini calls fail transiently (503 under load, 429) and models get retired (404).
Retry briefly, then fall through to the next model."""
import re
import time
from typing import Callable, Optional, Sequence

RETRYABLE = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "DEADLINE")
MAX_WORTH_WAITING_S = 5.0  # a quota that resets in hours is not worth a retry: try the next model now


def retry_after_seconds(message: str) -> Optional[float]:
    """Parses Google's "Please retry in 1h30m4.86s" / "retry in 34s" hint, if present."""
    m = re.search(r"retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", message)
    if not m or not any(m.groups()):
        return None
    h, mins, sec = m.groups()
    return int(h or 0) * 3600 + int(mins or 0) * 60 + float(sec or 0)


def worth_retrying(message: str) -> bool:
    if not any(tag in message for tag in RETRYABLE):
        return False
    wait = retry_after_seconds(message)
    return wait is None or wait <= MAX_WORTH_WAITING_S


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
                if not worth_retrying(str(exc)):
                    break  # e.g. 404 retired model, or a daily quota: try the next model now
                if attempt + 1 < attempts:
                    sleep(delay)
    if last is not None:
        raise last
    return None
