"""The data contract between the pipeline and the web player.

This module is the single source of truth: `smb schema` exports each root model as JSON
Schema, from which the TypeScript types in `web/src/contract/` are generated.
The pipeline only describes *what is where and when*; all musical and visual decisions live
in the player.

Three files are produced:
- `Day`     what happens on one service day (notes, textures, tunnel occupancy); drives sound
- `Motion`  how every moving vehicle travels along OSM geometry on that day; drives vehicles
- `Relief`  the shaded terrain image under the map; independent of the day

The street map itself comes from vector tiles built with Planetiler (see `make tiles`).

Coordinates: anything drawn is WGS84 longitude/latitude with 7 decimals (about 1 cm);
`easting_m`/`northing_m` are Swiss LV95 metres, used by the music for stereo position.
"""

from typing import Any, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.json_schema import GenerateJsonSchema
from pydantic_core import CoreSchema

SCHEMA_VERSION: Final = 3
MINUTES_PER_DAY: Final = 1440

NoteLayer = Literal["long_rail", "mountain_rail", "boat", "aerial", "funicular"]
TextureLayer = Literal["regional_rail", "tram", "bus"]
MovingLayer = Literal["long_rail", "mountain_rail", "regional_rail", "boat", "aerial", "funicular"]
RouteKind = Literal["track", "ferry_route", "straight"]


class _Model(BaseModel):
    model_config = ConfigDict(
        frozen=True, extra="forbid", json_schema_serialization_defaults_required=True
    )


def _require_equal_lengths(columns: dict[str, list[Any]]) -> None:
    lengths = {name: len(values) for name, values in columns.items()}
    if len(set(lengths.values())) > 1:
        raise ValueError(f"columns differ in length: {lengths}")


class Bounds(_Model):
    """Extent of the map in LV95 metres."""

    min_easting_m: float
    max_easting_m: float
    min_northing_m: float
    max_northing_m: float


# ── Day ──────────────────────────────────────────────────────────────────────────────────


class Station(_Model):
    """A parent station that emits note events."""

    name: str
    easting_m: float
    northing_m: float
    longitude: float
    latitude: float
    elevation_m: float


class NoteEvents(_Model):
    """Departures of sparse layers, stored column-wise to keep the file small.

    Row i is: at `minute[i]`, a vehicle of `layer[i]` departs from `stations[station[i]]`.
    """

    minute: list[int] = Field(description="Minute of day, 0..1439 (service after 24:00 wraps)")
    station: list[int] = Field(description="Index into Day.stations")
    layer: list[NoteLayer]
    trip_start: list[bool] = Field(description="True if this is the first stop of its trip")

    @model_validator(mode="after")
    def _columns_have_equal_length(self) -> Self:
        _require_equal_lengths(
            {
                "minute": self.minute,
                "station": self.station,
                "layer": self.layer,
                "trip_start": self.trip_start,
            }
        )
        return self


class TextureSeries(_Model):
    """Departure counts of a dense layer, per minute and per west-to-east bin."""

    layer: TextureLayer
    counts: list[list[int]] = Field(description="counts[minute][bin], bins ordered west to east")


class TunnelSeries(_Model):
    """How many trains are inside a long OSM tunnel at each minute of the day."""

    id: str = Field(description="Matches Motion.tunnels[].id")
    name: str
    easting_m: float
    northing_m: float
    occupancy: list[int] = Field(description="occupancy[minute], length MINUTES_PER_DAY")


class Day(_Model):
    """Everything the player needs to perform one service day."""

    schema_version: Literal[3] = SCHEMA_VERSION
    service_date: str = Field(description="ISO date, e.g. 2026-10-21")
    source: str = Field(description="Feed the day was built from")
    minutes_per_day: Literal[1440] = MINUTES_PER_DAY
    texture_bins: int
    bounds: Bounds
    stations: list[Station]
    notes: NoteEvents
    textures: list[TextureSeries]
    tunnels: list[TunnelSeries]


# ── Motion ───────────────────────────────────────────────────────────────────────────────


class TunnelPassage(_Model):
    """The part of a segment that runs inside a tunnel, as fractions of the segment length."""

    tunnel: int = Field(description="Index into Motion.tunnels")
    start_fraction: float
    end_fraction: float


class Segment(_Model):
    """The path between two consecutive stops, shared by every trip that uses it."""

    coordinates: list[float] = Field(
        description="Flat [longitude, latitude, ...]; OSM geometry with redundant points removed"
    )
    overview_coordinates: list[float] = Field(
        description="The same path simplified to 15 m, for country-wide views"
    )
    length_m: int = Field(description="Length along the network")
    route: RouteKind = Field(description="How the path was found")
    tunnels: list[TunnelPassage]


class Trips(_Model):
    """Column-wise: trip i has `layer[i]` and legs `first_leg[i] .. first_leg[i]+leg_count[i]`."""

    layer: list[MovingLayer]
    first_leg: list[int]
    leg_count: list[int]

    @model_validator(mode="after")
    def _columns_have_equal_length(self) -> Self:
        _require_equal_lengths(
            {"layer": self.layer, "first_leg": self.first_leg, "leg_count": self.leg_count}
        )
        return self


class Legs(_Model):
    """Column-wise: leg i travels `segments[segment[i]]` (backwards if `reversed`)."""

    segment: list[int]
    reversed: list[bool]
    depart_minute: list[int] = Field(description="May exceed 1440 for trips past midnight")
    arrive_minute: list[int]

    @model_validator(mode="after")
    def _columns_have_equal_length(self) -> Self:
        _require_equal_lengths(
            {
                "segment": self.segment,
                "reversed": self.reversed,
                "depart_minute": self.depart_minute,
                "arrive_minute": self.arrive_minute,
            }
        )
        return self


class Tunnel(_Model):
    """A long tunnel found in OpenStreetMap (`tunnel=yes` on rail ways)."""

    id: str
    name: str = Field(description="OSM name, or 'Tunnel near <station>' when OSM has none")
    length_m: int
    coordinates: list[float] = Field(description="Flat [longitude, latitude, ...] of its axis")


class Motion(_Model):
    """How every moving vehicle travels on one service day."""

    schema_version: Literal[3] = SCHEMA_VERSION
    service_date: str
    segments: list[Segment]
    trips: Trips
    legs: Legs
    tunnels: list[Tunnel]


# ── Relief ───────────────────────────────────────────────────────────────────────────


class Relief(_Model):
    """A shaded-relief image, Web-Mercator aligned, transparent outside Switzerland."""

    schema_version: Literal[3] = SCHEMA_VERSION
    image: str = Field(description="PNG file name, next to this file")
    west: float = Field(description="Longitude of the left edge")
    south: float = Field(description="Latitude of the bottom edge")
    east: float
    north: float
    attribution: str


# ── Asset bundle ─────────────────────────────────────────────────────────────────────


class AssetBundle(_Model):
    """Binary map assets (vector tiles or label glyphs) packed into one JSON file.

    Some static hosts only serve common web file types; protobuf tiles and glyphs are not
    among them. The player reads entries from bundles through a `bundle://` map protocol.
    """

    schema_version: Literal[3] = SCHEMA_VERSION
    entries: dict[str, str] = Field(description="Entry name (e.g. 'x/y') -> base64 bytes")


# ── Schema export ────────────────────────────────────────────────────────────────────────


class _WithoutFieldTitles(GenerateJsonSchema):
    """Omit per-field titles, so generated TypeScript gets no `Name1`-style aliases."""

    def field_title_should_be_set(self, schema: CoreSchema) -> bool:
        return False


ROOT_MODELS: Final[dict[str, type[BaseModel]]] = {
    "day": Day,
    "motion": Motion,
    "relief": Relief,
    "asset_bundle": AssetBundle,
}


def json_schemas() -> dict[str, dict[str, Any]]:
    """JSON Schema of every root model, keyed by file stem; input for the TS generator."""
    return {
        stem: model.model_json_schema(mode="serialization", schema_generator=_WithoutFieldTitles)
        for stem, model in ROOT_MODELS.items()
    }
