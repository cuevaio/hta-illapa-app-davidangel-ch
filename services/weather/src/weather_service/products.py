"""Generic layer product model and the registry of GFS-derived products."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal, Protocol

import numpy as np

from .gfs import FieldSpec
from .precip import ACCUM_DEFINITION, RATE_DEFINITION, FieldRef, PrecipDeriver

Kind = Literal["observed", "forecast"]
ValueKind = Literal["scalar", "vector"]

GFS_SOURCE = "NOAA GFS 0.25° (NCEP), via NOAA Open Data Dissemination on AWS"
GFS_ATTRIBUTION = "NOAA/NCEP Global Forecast System"


def kelvin_to_celsius(values: np.ndarray) -> np.ndarray:
    return values - 273.15


def identity(values: np.ndarray) -> np.ndarray:
    return values


class Deriver(Protocol):
    """Builds a frame from messages of several forecast hours (e.g. accumulation differences)."""

    band_names: tuple[str, ...]

    def inputs(self, fhour: int, prev_fhour: int | None) -> list[FieldRef]: ...

    def bands(self, values: dict[str, np.ndarray], fhour: int, prev_fhour: int | None) -> list[tuple[str, np.ndarray]]: ...

    def frame_meta(self, fhour: int, prev_fhour: int | None, issue_time: str) -> dict: ...


@dataclass(frozen=True)
class ProductSpec:
    id: str
    title: str
    kind: Kind
    source: str
    attribution: str
    #: Units of the served values (after `transform`).
    units: str
    field: FieldSpec
    #: Suggested display range for palettes/legends, in served units.
    display_range: tuple[float, float]
    transform: Callable[[np.ndarray], np.ndarray] = identity
    description: str = ""
    #: Forecast field used at f000 when the regular selector has no analysis (e.g. averages).
    f000_field: FieldSpec | None = None
    extra: dict = field(default_factory=dict)
    #: Extra named bands after `field` (e.g. the v component of a wind vector).
    extra_bands: tuple[tuple[str, FieldSpec], ...] = ()
    #: Name of the band selected by `field`.
    band_name: str = "value"
    value_kind: ValueKind = "scalar"
    #: Derived products: inputs/bands computed by the deriver (`field`/`transform` unused then).
    deriver: Deriver | None = None

    def field_for(self, fhour: int) -> FieldSpec:
        return self.f000_field if fhour == 0 and self.f000_field else self.field

    def fields_for(self, fhour: int) -> list[tuple[str, FieldSpec]]:
        """Named fields encoded as bands of one frame, in band order."""
        return [(self.band_name, self.field_for(fhour)), *self.extra_bands]

    @property
    def band_names(self) -> list[str]:
        if self.deriver is not None:
            return list(self.deriver.band_names)
        return [self.band_name, *(n for n, _ in self.extra_bands)]


TEMPERATURE_2M = ProductSpec(
    id="gfs-t2m",
    title="Temperature (2 m)",
    kind="forecast",
    source=GFS_SOURCE,
    attribution=GFS_ATTRIBUTION,
    units="°C",
    field=FieldSpec("TMP", "2 m above ground"),
    display_range=(-10.0, 40.0),
    transform=kelvin_to_celsius,
    description="Air temperature 2 m above ground (GFS TMP), converted from K to °C.",
)

WIND_10M = ProductSpec(
    id="gfs-wind10m",
    title="Wind (10 m)",
    kind="forecast",
    source=GFS_SOURCE,
    attribution=GFS_ATTRIBUTION,
    units="m/s",
    field=FieldSpec("UGRD", "10 m above ground"),
    band_name="u",
    extra_bands=(("v", FieldSpec("VGRD", "10 m above ground")),),
    value_kind="vector",
    display_range=(0.0, 25.0),
    description="Wind 10 m above ground (GFS UGRD/VGRD): u > 0 toward the east, v > 0 toward the north, m/s.",
)

PRECIPITATION = ProductSpec(
    id="gfs-precip",
    title="Precipitation (forecast)",
    kind="forecast",
    source=GFS_SOURCE,
    attribution=GFS_ATTRIBUTION,
    units="mm/h",
    field=FieldSpec("APCP", "surface"),
    band_name="rate",
    deriver=PrecipDeriver(),
    display_range=(0.0, 50.0),
    description="Forecast precipitation (GFS): rate in mm/h and accumulation in mm since the cycle start.",
    extra={
        "bands": {
            "rate": {"units": "mm/h", "definition": RATE_DEFINITION},
            "accum": {"units": "mm", "definition": ACCUM_DEFINITION},
        },
    },
)

CAPE_SURFACE = ProductSpec(
    id="gfs-cape",
    title="Convective potential (forecast)",
    kind="forecast",
    source=GFS_SOURCE,
    attribution=GFS_ATTRIBUTION,
    units="J/kg",
    # f000 is "anl", later hours "N hour fcst" (instantaneous); never an average.
    field=FieldSpec("CAPE", "surface", r"^(?:anl|\d+ hour fcst)$"),
    display_range=(0.0, 4000.0),
    description=(
        "Surface-based convective available potential energy (GFS CAPE:surface), J/kg: forecast potential "
        "for convection, not observed storms."
    ),
    extra={"categories": [[250, "marginal"], [1000, "moderate"], [2500, "high"]]},
)

PRODUCTS: dict[str, ProductSpec] = {p.id: p for p in (TEMPERATURE_2M, WIND_10M, PRECIPITATION, CAPE_SURFACE)}
