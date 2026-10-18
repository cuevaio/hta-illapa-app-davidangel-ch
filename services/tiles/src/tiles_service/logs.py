"""Structured JSON logs with secret redaction."""

from __future__ import annotations

import datetime as dt
import json
import logging
import sys
import traceback

LOGGER_NAME = "tiles"
log = logging.getLogger(LOGGER_NAME)
_STD = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


class RedactFilter(logging.Filter):
    def __init__(self, secrets: list[str]):
        super().__init__()
        self.secrets = [s for s in secrets if s]

    def redact(self, text: str) -> str:
        for s in self.secrets:
            text = text.replace(s, "***")
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.redact(record.getMessage())
        record.args = None
        if record.exc_info:
            record.exc_text = self.redact("".join(traceback.format_exception(*record.exc_info)))
            record.exc_info = None
        for k, v in list(record.__dict__.items()):
            if k not in _STD and isinstance(v, str):
                setattr(record, k, self.redact(v))
        return True


class JsonFormatter(logging.Formatter):
    def __init__(self, redact: RedactFilter | None = None):
        super().__init__()
        self._redact = redact

    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": dt.datetime.fromtimestamp(record.created, dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "nivel": record.levelname,
            "msg": record.getMessage(),
        }
        for k, v in record.__dict__.items():
            if k not in _STD and not k.startswith("_"):
                out[k] = v
        if record.exc_text:
            out["exc"] = record.exc_text
        text = json.dumps(out, ensure_ascii=False, default=str)
        return self._redact.redact(text) if self._redact else text


def setup_logging(level: str, secrets: list[str]) -> RedactFilter:
    redact = RedactFilter(secrets)
    for f in list(log.filters):
        if isinstance(f, RedactFilter):
            log.removeFilter(f)
    log.addFilter(redact)
    for h in list(log.handlers):
        if getattr(h, "_tiles", False):
            log.removeHandler(h)
    handler = logging.StreamHandler(sys.stderr)
    handler._tiles = True  # type: ignore[attr-defined]
    handler.setFormatter(JsonFormatter(redact))
    log.addHandler(handler)
    log.setLevel(level.upper())
    return redact
