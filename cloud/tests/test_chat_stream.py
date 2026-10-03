import asyncio
import base64
import json

import httpx
from fastapi.testclient import TestClient

from app.chat import ChatRequest
from app.chat_stream import MAX_SENTENCES, stream_reply
from app.main import create_app
from app.sentences import SentenceSplitter
from app.tts import Tts

REQ = ChatRequest(message="how was that?")


# ---------------- splitter ----------------

def split_all(chunks, **kw):
    s = SentenceSplitter(**kw)
    out = []
    for c in chunks:
        out += s.feed(c)
    rest = s.flush()
    return out + ([rest] if rest else [])


def test_splits_on_sentence_ends_and_keeps_the_rest_until_flush():
    s = SentenceSplitter()
    assert s.feed("You rolled the stop at Elm. Next time ") == ["You rolled the stop at Elm."]
    assert s.feed("come to a full stop first") == []
    assert s.flush() == "Next time come to a full stop first"


def test_decimals_and_abbreviations_do_not_split():
    out = split_all(["Your score was 82.5 out of 100 today. Dr. Lee agrees with the coach here. Good."])
    # "82.5" and "Dr." are not sentence ends; the short tail is flushed on its own
    assert out == ["Your score was 82.5 out of 100 today.", "Dr. Lee agrees with the coach here.", "Good."]


def test_short_fragments_merge_into_the_next_sentence():
    assert split_all(["Yes. That was a smooth turn overall. Keep it up!"]) == [
        "Yes. That was a smooth turn overall.",
        "Keep it up!",
    ]


def test_trailing_period_waits_in_case_more_digits_follow():
    s = SentenceSplitter()
    assert s.feed("You were going about 62") == []
    assert s.feed(".") == []  # could be "62.5": do not emit yet
    assert s.feed("5 miles per hour on that road.") == []
    assert s.flush() == "You were going about 62.5 miles per hour on that road."


def test_chunking_never_changes_the_result():
    text = "That was a clean stop at the sign. Your braking was smooth! Would you like a tip for the next one? Sure."
    whole = split_all([text])
    assert split_all(list(text)) == whole  # character by character
    assert split_all([text[i : i + 7] for i in range(0, len(text), 7)]) == whole


# ---------------- pipeline ----------------

async def collect(agen):
    return [p async for p in agen]


def gemini_of(chunks, log=None, boom_after=None):
    async def stream(system, message):
        for i, c in enumerate(chunks):
            if boom_after is not None and i == boom_after:
                raise RuntimeError("503 UNAVAILABLE")
            if log is not None:
                log.append(f"gemini:{i}")
            yield c
            await asyncio.sleep(0)

    return stream


def synth_of(log=None, fail=()):
    async def synth(text, previous):
        if log is not None:
            log.append(f"tts:{text[:12]}|prev={'yes' if previous else 'no'}")
        await asyncio.sleep(0)
        return None if text in fail else b"MP3" + text.encode()

    return synth


def test_streams_sentences_in_order_with_audio():
    chunks = ["That was a clean stop at the sign. ", "Your braking was smooth overall. ", "Keep that up on the next one!"]
    packets = asyncio.run(collect(stream_reply(REQ, gemini_of(chunks), synth_of())))
    sentences = [p for p in packets if p["type"] == "sentence"]
    assert [p["i"] for p in sentences] == [0, 1, 2]
    assert sentences[0]["text"] == "That was a clean stop at the sign."
    assert base64.b64decode(sentences[1]["audio"]).startswith(b"MP3Your braking")
    assert packets[-1]["type"] == "done"


def test_speech_for_sentence_one_starts_before_gemini_has_finished():
    log = []
    chunks = ["That was a clean stop at the sign. ", "Your braking was smooth overall. ", "Keep that up on the next one!"]
    asyncio.run(collect(stream_reply(REQ, gemini_of(chunks, log), synth_of(log))))
    first_tts = next(i for i, e in enumerate(log) if e.startswith("tts:That was a") and e.endswith("prev=no"))
    assert first_tts < log.index("gemini:2")  # pipelined, not sequential
    assert any("prev=yes" in e for e in log)  # later sentences get the previous one for tone continuity


def test_caps_the_reply_length():
    many = ["This is sentence number %d of a very long and rambling answer. " % i for i in range(10)]
    packets = asyncio.run(collect(stream_reply(REQ, gemini_of(many), synth_of())))
    assert len([p for p in packets if p["type"] == "sentence"]) == MAX_SENTENCES


def test_failed_speech_still_delivers_the_text():
    chunks = ["That was a clean stop at the sign. ", "Your braking was smooth overall."]
    packets = asyncio.run(collect(stream_reply(REQ, gemini_of(chunks), synth_of(fail={"That was a clean stop at the sign."}))))
    first = packets[0]
    assert first["audio"] is None and first["text"] == "That was a clean stop at the sign."
    assert packets[1]["audio"] is not None


def test_no_speech_service_means_text_only():
    packets = asyncio.run(collect(stream_reply(REQ, gemini_of(["One full sentence here for you."]), None)))
    assert packets[0]["audio"] is None and packets[0]["text"] == "One full sentence here for you."


def test_gemini_failing_before_any_text_sends_an_apology_not_silence():
    packets = asyncio.run(collect(stream_reply(REQ, gemini_of(["x"], boom_after=0), synth_of())))
    assert packets[0]["text"] == "Sorry, I can't answer that right now."
    assert packets[-1]["type"] == "done"


def test_gemini_failing_midway_keeps_what_was_already_said():
    chunks = ["That was a clean stop at the sign. ", "never arrives"]
    packets = asyncio.run(collect(stream_reply(REQ, gemini_of(chunks, boom_after=1), synth_of())))
    assert [p["type"] for p in packets] == ["sentence", "done"]
    assert packets[0]["text"] == "That was a clean stop at the sign."


def test_no_gemini_configured_sends_the_apology():
    packets = asyncio.run(collect(stream_reply(REQ, None, None)))
    assert packets[0]["text"] == "Sorry, I can't answer that right now."


def test_phone_disconnect_cancels_gemini_and_speech():
    state = {"gemini_cancelled": False, "tts_cancelled": False}

    async def endless(system, message):
        try:
            while True:
                yield "A full sentence that keeps the model busy. "
                await asyncio.sleep(0.01)
        finally:  # runs when the stream is cancelled OR explicitly closed
            state["gemini_cancelled"] = True

    async def slow_tts(text, previous):
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            state["tts_cancelled"] = True
            raise

    async def run():
        async def consume():
            async for _ in stream_reply(REQ, endless, slow_tts):
                pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        task.cancel()  # what the server does when the phone disconnects mid-reply
        try:
            await task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.05)

    asyncio.run(run())
    assert state["gemini_cancelled"] and state["tts_cancelled"]


# ---------------- endpoint ----------------

class FakeTts:
    async def synthesize(self, text, previous=None):
        return b"AUDIO"


def test_endpoint_streams_ndjson(tmp_path):
    chunks = ["That was a clean stop at the sign. ", "Your braking was smooth overall."]
    c = TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path, text_stream=gemini_of(chunks), tts=FakeTts()))
    with c.stream("POST", "/chat/stream", json={"message": "how was that?", "smoothness": 80}) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/x-ndjson")
        packets = [json.loads(line) for line in r.iter_lines() if line]
    assert [p["type"] for p in packets] == ["sentence", "sentence", "done"]
    assert base64.b64decode(packets[0]["audio"]) == b"AUDIO"


def test_endpoint_validates_and_degrades_without_services(tmp_path):
    c = TestClient(create_app(db_path=str(tmp_path / "t.db"), models_dir=tmp_path))
    assert c.post("/chat/stream", json={"message": ""}).status_code == 422
    r = c.post("/chat/stream", json={"message": "hi"})
    packets = [json.loads(line) for line in r.text.splitlines() if line]
    assert packets[0]["text"].startswith("Sorry") and packets[-1]["type"] == "done"


# ---------------- Tts ----------------

def test_tts_caches_sends_previous_text_and_degrades_to_none():
    calls = []

    def handler(req: httpx.Request):
        calls.append(json.loads(req.content))
        return httpx.Response(200, content=b"MP3DATA")

    async def run():
        tts = Tts("k", "voice", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        a = await tts.synthesize("Hello there driver.", previous_text="Earlier sentence.")
        b = await tts.synthesize("Hello there driver.")  # cache hit: no second request, no extra credits
        return a, b

    a, b = asyncio.run(run())
    assert a == b == b"MP3DATA" and len(calls) == 1
    assert calls[0]["previous_text"] == "Earlier sentence." and calls[0]["model_id"] == "eleven_flash_v2_5"

    async def failing():
        tts = Tts("k", "v", client=httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401))))
        return await tts.synthesize("x y z")

    assert asyncio.run(failing()) is None


def test_upstream_is_closed_as_soon_as_the_reply_is_long_enough():
    closed = {"v": False}

    async def endless(system, message):
        try:
            while True:
                yield "A complete sentence that is long enough to count. "
        finally:
            closed["v"] = True

    packets = asyncio.run(collect(stream_reply(REQ, endless, synth_of())))
    assert len([p for p in packets if p["type"] == "sentence"]) == MAX_SENTENCES
    assert closed["v"]  # Gemini stopped generating; we are not paying for text nobody will hear
