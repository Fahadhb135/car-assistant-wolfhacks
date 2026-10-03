"""Streamed coach replies: Gemini text stream -> sentences -> per-sentence speech, pipelined so the
first sentence is spoken while the rest is still being written.

Output is a sequence of packets (sent to the phone as one JSON object per line):
  {"type":"sentence","i":0,"text":"...","audio":"<base64 mp3>"|null,"mime":"audio/mpeg","ms":812}
  {"type":"done","ms":...}
Failures never leave the phone silent: if nothing can be said, one apology sentence is sent."""
import asyncio
import base64
import time
from typing import AsyncIterator, Awaitable, Callable, Optional

from .chat import FALLBACK, system_instruction, ChatRequest
from .gemini_util import worth_retrying
from .sentences import SentenceSplitter

TextStream = Callable[[str, str], AsyncIterator[str]]  # (system, message) -> text deltas
Synth = Callable[[str, Optional[str]], Awaitable[Optional[bytes]]]  # (text, previous_text) -> mp3 | None

MAX_SENTENCES = 3
MAX_CHARS = 320


def _packet(i: int, text: str, audio: Optional[bytes], start: float) -> dict:
    return {
        "type": "sentence", "i": i, "text": text, "mime": "audio/mpeg",
        "audio": base64.b64encode(audio).decode() if audio else None,
        "ms": int((time.monotonic() - start) * 1000),
    }


async def stream_reply(req: ChatRequest, text_stream: Optional[TextStream], synth: Optional[Synth]) -> AsyncIterator[dict]:
    start = time.monotonic()
    queue: "asyncio.Queue" = asyncio.Queue()
    tasks: list[asyncio.Task] = []

    def start_speech(text: str, previous: Optional[str]) -> "asyncio.Future[Optional[bytes]]":
        if synth is None:
            f: asyncio.Future = asyncio.get_running_loop().create_future()
            f.set_result(None)
            return f
        t = asyncio.create_task(synth(text, previous))
        tasks.append(t)
        return t

    async def produce() -> None:
        n, chars, previous = 0, 0, None
        splitter = SentenceSplitter()

        def emit(sentence: str) -> bool:
            nonlocal n, chars, previous
            if n >= MAX_SENTENCES or chars >= MAX_CHARS:
                return False
            queue.put_nowait((n, sentence, start_speech(sentence, previous)))
            n, chars, previous = n + 1, chars + len(sentence), sentence
            return True

        upstream = text_stream(system_instruction(req), req.message) if text_stream is not None else None
        try:
            if upstream is not None:
                async for delta in upstream:
                    if any(not emit(s) for s in splitter.feed(delta)):
                        break
                else:
                    rest = splitter.flush()
                    if rest:
                        emit(rest)
        except Exception:
            pass  # a mid-stream failure just ends the reply; an empty reply gets the apology below
        finally:
            if upstream is not None:
                try:  # stop the model generating (and billing) once we have enough or the phone left
                    await upstream.aclose()
                except Exception:
                    pass
            if n == 0:
                queue.put_nowait((0, FALLBACK, start_speech(FALLBACK, None)))
            queue.put_nowait(None)

    producer = asyncio.create_task(produce())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            i, text, speech = item
            audio = await speech
            yield _packet(i, text, audio, start)
        yield {"type": "done", "ms": int((time.monotonic() - start) * 1000)}
    finally:  # runs on completion AND when the phone disconnects: stop paying for Gemini/TTS
        producer.cancel()
        for t in tasks:
            t.cancel()


def chat_text_stream_from_env(api_key: str, models: list[str]) -> TextStream:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    async def stream(system: str, message: str) -> AsyncIterator[str]:
        last: Optional[Exception] = None
        for model in models:
            for attempt in range(2):
                started = False
                try:
                    config = types.GenerateContentConfig(system_instruction=system, max_output_tokens=220)
                    async for chunk in await client.aio.models.generate_content_stream(
                        model=model, contents=message, config=config
                    ):
                        if chunk.text:
                            started = True
                            yield chunk.text
                    return
                except Exception as exc:
                    last = exc
                    if started:
                        raise  # can't take back what was already spoken
                    if not worth_retrying(str(exc)):
                        break  # retired model, daily quota etc: next model
                    await asyncio.sleep(0.4)
        if last:
            raise last

    return stream
