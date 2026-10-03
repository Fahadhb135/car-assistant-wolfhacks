"""Server-side ElevenLabs speech for streamed replies. The key stays on the server (the phone never
sees it) and results are cached, since coaching answers repeat and the free plan has a character budget."""
from collections import OrderedDict
from typing import Optional

import httpx

MODEL = "eleven_flash_v2_5"  # lowest latency; half the per-character cost of the bigger models


class Tts:
    def __init__(self, api_key: str, voice_id: str, client: Optional[httpx.AsyncClient] = None,
                 timeout: float = 4.0, cache_size: int = 64):
        self.api_key, self.voice_id, self.timeout = api_key, voice_id, timeout
        self.client = client or httpx.AsyncClient()
        self._cache: "OrderedDict[tuple[str, str], bytes]" = OrderedDict()
        self._cache_size = cache_size

    async def synthesize(self, text: str, previous_text: Optional[str] = None) -> Optional[bytes]:
        """MP3 bytes, or None on any failure (the caller then falls back to the phone's own voice)."""
        key = (self.voice_id, text)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        body: dict = {"text": text, "model_id": MODEL}
        if previous_text:
            body["previous_text"] = previous_text  # keeps tone continuous across sentences
        try:
            r = await self.client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}?output_format=mp3_44100_64",
                headers={"xi-api-key": self.api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
                json=body,
                timeout=self.timeout,
            )
            if r.status_code != 200 or not r.content:
                return None
        except Exception:
            return None
        self._cache[key] = r.content
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return r.content
