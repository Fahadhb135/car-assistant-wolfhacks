"""Incremental sentence splitting for streamed LLM text, so speech can start on sentence 1
while the model is still writing sentence 2."""
import re

_BOUNDARY = re.compile(r"""([.!?]+["')\]]*)(\s+)""")
_ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "vs", "etc", "e.g", "i.e", "approx", "no"}


class SentenceSplitter:
    """feed() returns sentences completed so far; flush() returns whatever is left.

    - A boundary needs whitespace after the punctuation, so "2.5" and a trailing "." that might
      be followed by more digits are never split.
    - Very short fragments ("Yes.") are merged into the next sentence: they sound choppy alone.
    """

    def __init__(self, min_chars: int = 20):
        self.min_chars = min_chars
        self._buf = ""

    def feed(self, text: str) -> list[str]:
        self._buf += text
        out: list[str] = []
        while True:
            cut = self._next_cut()
            if cut is None:
                return out
            out.append(self._buf[:cut].strip())
            self._buf = self._buf[cut:].lstrip()

    def flush(self) -> str:
        rest, self._buf = self._buf.strip(), ""
        return rest

    def _next_cut(self):
        for m in _BOUNDARY.finditer(self._buf):
            candidate = self._buf[: m.end(1)].strip()
            word = re.findall(r"[A-Za-z.]+$", self._buf[: m.start(1)])
            if word and word[0].lower().rstrip(".") in _ABBREVIATIONS and m.group(1) == ".":
                continue  # "Dr. Smith", "e.g. this"
            if len(candidate) < self.min_chars:
                continue  # too short on its own: merge with the next sentence
            return m.end(1)
        return None
