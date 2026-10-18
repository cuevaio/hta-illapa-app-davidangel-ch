"""NOAA GFS 0.25 deg on AWS open data: .idx parsing, byte ranges and cycle selection."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

BUCKET_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
CYCLE_HOURS = 6


@dataclass(frozen=True)
class IdxEntry:
    number: str
    offset: int
    #: Inclusive last byte, or None for the last message (read to the end of the file).
    end: int | None
    date: str
    variable: str
    level: str
    forecast: str

    @property
    def range_header(self) -> str:
        return f"bytes={self.offset}-" if self.end is None else f"bytes={self.offset}-{self.end}"


@dataclass(frozen=True)
class FieldSpec:
    """Selects one GRIB message: variable and level, plus an optional forecast-description regex."""

    variable: str
    level: str
    forecast: str | None = None

    def matches(self, e: IdxEntry) -> bool:
        if e.variable != self.variable or e.level != self.level:
            return False
        return self.forecast is None or re.search(self.forecast, e.forecast) is not None

    @property
    def key(self) -> str:
        """Raw-cache key; selectors with a forecast regex get their own key."""
        base = f"{self.variable}_{self.level}" + (f"_{self.forecast}" if self.forecast else "")
        return re.sub(r"[^A-Za-z0-9]+", "_", base).strip("_").lower()


def parse_idx(text: str) -> list[IdxEntry]:
    """Parses a wgrib2-style inventory: `num:offset:d=YYYYMMDDHH:VAR:level:forecast:`."""
    rows: list[tuple[str, int, str, str, str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(":")
        if len(parts) < 6:
            raise ValueError(f"malformed idx line: {line!r}")
        number, offset, date, variable, level, forecast = parts[:6]
        rows.append((number, int(offset), date.removeprefix("d="), variable, level, forecast))
    # Sub-messages (e.g. "12.1", "12.2") share the byte offset of their parent message.
    offsets = sorted({r[1] for r in rows})
    next_offset = {o: offsets[i + 1] for i, o in enumerate(offsets[:-1])}
    return [
        IdxEntry(n, o, (next_offset[o] - 1) if o in next_offset else None, d, v, lv, f)
        for n, o, d, v, lv, f in rows
    ]


def find_entry(entries: list[IdxEntry], spec: FieldSpec) -> IdxEntry:
    for e in entries:
        if spec.matches(e):
            return e
    raise LookupError(f"{spec.variable}:{spec.level} ({spec.forecast or 'any'}) not in inventory")


def cycle_token(cycle: dt.datetime) -> str:
    return cycle.strftime("%Y%m%d%H")


def parse_cycle_token(token: str) -> dt.datetime:
    return dt.datetime.strptime(token, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)


def grib_url(cycle: dt.datetime, fhour: int, base: str = BUCKET_URL) -> str:
    hh = f"{cycle.hour:02d}"
    return f"{base}/gfs.{cycle:%Y%m%d}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fhour:03d}"


def idx_url(cycle: dt.datetime, fhour: int, base: str = BUCKET_URL) -> str:
    return grib_url(cycle, fhour, base) + ".idx"


def candidate_cycles(now: dt.datetime, count: int) -> list[dt.datetime]:
    """Most recent cycles at or before `now`, newest first."""
    now = now.astimezone(dt.timezone.utc)
    latest = now.replace(hour=now.hour - now.hour % CYCLE_HOURS, minute=0, second=0, microsecond=0)
    return [latest - dt.timedelta(hours=CYCLE_HOURS * i) for i in range(count)]


def parse_fhours(spec: str) -> list[int]:
    """'0-48:3' -> [0, 3, ..., 48]; '0,6,12' -> [0, 6, 12]; ranges and lists can be mixed."""
    hours: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d+)-(\d+)(?::(\d+))?", part)
        if m:
            start, stop, step = int(m.group(1)), int(m.group(2)), int(m.group(3) or 1)
            if step <= 0 or stop < start:
                raise ValueError(f"bad forecast hour range: {part}")
            hours.update(range(start, stop + 1, step))
        elif part.isdigit():
            hours.add(int(part))
        else:
            raise ValueError(f"bad forecast hour spec: {part}")
    if not hours or max(hours) > 384:
        raise ValueError(f"bad forecast hours: {spec}")
    return sorted(hours)
