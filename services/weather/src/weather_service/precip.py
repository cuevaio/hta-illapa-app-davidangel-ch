"""GFS precipitation: unit conversion, message selection and accumulation differencing.

GFS inventories carry several precipitation messages per forecast hour:
PRATE instantaneous ("N hour fcst"), PRATE averaged over the current 3 h or
6 h bucket ("6-9 hour ave fcst" / "6-12 hour ave fcst"), APCP for the bucket
("6-9 hour acc fcst") and APCP as a running total since the cycle start
("0-9 hour acc fcst"). Buckets alternate between 3 h and 6 h, so the served
fields are derived from the running total, which is uniform:

* rate (mm/h): mean rate over the window between the previous served forecast
  hour and this one, (APCP[0-N] - APCP[0-prev]) / (N - prev). With a 3-hourly
  timeline this is the 3-hour average rate ending at the valid time. At f000
  there is no window, so the instantaneous PRATE analysis is used.
* accum (mm): APCP running total since the cycle start (0 at f000).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .gfs import FieldSpec

#: Seconds per hour: 1 kg m^-2 of water is 1 mm, so kg m^-2 s^-1 * 3600 = mm/h.
SECONDS_PER_HOUR = 3600.0

PRATE_ANALYSIS = FieldSpec("PRATE", "surface", r"^anl$")


def apcp_running_total(fhour: int) -> FieldSpec:
    """APCP accumulated from the cycle start to `fhour` (never the 3 h / 6 h bucket)."""
    if fhour <= 0:
        raise ValueError("APCP has no accumulation at f000")
    # wgrib2 writes whole days in day units: the f024 running total is "0-1 day acc fcst".
    span = f"(?:{fhour} hour|{fhour // 24} day)" if fhour % 24 == 0 else f"{fhour} hour"
    return FieldSpec("APCP", "surface", rf"^0-{span} acc fcst$")


def prate_to_mm_per_hour(values: np.ndarray) -> np.ndarray:
    """kg m^-2 s^-1 -> mm/h; negative packing noise is clipped to 0, NaN kept."""
    return np.where(np.isnan(values), np.nan, np.maximum(values * SECONDS_PER_HOUR, 0.0))


def mean_rate_from_accumulation(acc: np.ndarray, prev_acc: np.ndarray | None, hours: float) -> np.ndarray:
    """Mean rate (mm/h) over `hours` from two running totals in mm (prev None = 0 mm)."""
    if hours <= 0:
        raise ValueError("accumulation window must be positive")
    prev = 0.0 if prev_acc is None else prev_acc
    diff = acc - prev
    return np.where(np.isnan(diff), np.nan, np.maximum(diff, 0.0) / hours)


@dataclass(frozen=True)
class FieldRef:
    """One input message of a derived frame: a selector applied to the file of `fhour`."""

    name: str
    field: FieldSpec
    fhour: int


class PrecipDeriver:
    band_names = ("rate", "accum")

    def inputs(self, fhour: int, prev_fhour: int | None) -> list[FieldRef]:
        if fhour == 0:
            return [FieldRef("prate", PRATE_ANALYSIS, 0)]
        refs = [FieldRef("acc", apcp_running_total(fhour), fhour)]
        if prev_fhour:
            refs.append(FieldRef("acc_prev", apcp_running_total(prev_fhour), prev_fhour))
        return refs

    def bands(self, values: dict[str, np.ndarray], fhour: int, prev_fhour: int | None) -> list[tuple[str, np.ndarray]]:
        if fhour == 0:
            rate = prate_to_mm_per_hour(values["prate"])
            accum = np.where(np.isnan(rate), np.nan, 0.0)
        else:
            acc = values["acc"]
            start = prev_fhour or 0
            rate = mean_rate_from_accumulation(acc, values.get("acc_prev"), fhour - start)
            accum = np.where(np.isnan(acc), np.nan, np.maximum(acc, 0.0))
        return [("rate", rate.astype(np.float32)), ("accum", accum.astype(np.float32))]

    def frame_meta(self, fhour: int, prev_fhour: int | None, issue_time: str) -> dict:
        if fhour == 0:
            rate = {"method": "instantaneous-analysis", "windowHours": [0, 0], "field": "PRATE:surface:anl"}
        else:
            start = prev_fhour or 0
            rate = {"method": "mean-of-accumulation", "windowHours": [start, fhour], "field": "APCP:surface:0-N hour acc fcst"}
        return {
            "rate": rate | {"units": "mm/h"},
            "accumulation": {"windowHours": [0, fhour], "since": issue_time, "units": "mm"},
        }


RATE_DEFINITION = (
    "Mean precipitation rate over the 3-hour window ending at the valid time (with the default 3-hourly "
    "timeline), derived by differencing APCP running totals; f000 shows the instantaneous PRATE analysis."
)
ACCUM_DEFINITION = "Total precipitation accumulated since the cycle start (APCP running total, 0 at f000)."
