"""Reading OpenStreetMap: an adapter around pyosmium that yields typed records.

Nothing outside this module touches pyosmium. The street map itself comes from vector
tiles (Planetiler); the pipeline only needs the transport networks vehicles travel on, and
the national border that cuts the relief to Switzerland's shape.
"""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal

import numpy as np
import numpy.typing as npt
import osmium
import shapely
from osmium.geom import WKBFactory

from smb_pipeline.contract import Ropeway
from smb_pipeline.geo import FloatArray, lv95_from_wgs84_arrays

IntArray = npt.NDArray[np.int64]
NetworkKind = Literal["rail", "mountain_rail", "funicular", "ferry", "aerialway"]

RAILWAY_KINDS: Final[Mapping[str, NetworkKind]] = {
    "rail": "rail",
    "light_rail": "rail",
    "narrow_gauge": "mountain_rail",
    "funicular": "funicular",
}
# Ropeways that carry timetabled passengers; goods lifts and ski drags don't.
ROPEWAY_KINDS: Final[Mapping[str, Ropeway]] = {
    "cable_car": "cable_car",
    "gondola": "gondola",
    "mixed_lift": "gondola",
    "chair_lift": "chair_lift",
}
# OSM rarely tags a pylon's height (2 of ~11,800 in Switzerland); typical heights by ropeway.
DEFAULT_PYLON_HEIGHT_M: Final[Mapping[Ropeway, float]] = {
    "cable_car": 30.0,
    "gondola": 15.0,
    "chair_lift": 10.0,
}
NAME_TAGS: Final = ("tunnel:name", "name", "name:de", "name:fr", "name:it")
SWITZERLAND_ISO_CODE: Final = "CH"
MIN_POINTS_PER_LINE: Final = 2
# Let pyosmium skip every other object in C++ before Python sees it.
NETWORK_KEYS: Final = ("railway", "route", "aerialway")
BORDER_KEY: Final = "boundary"


@dataclass(frozen=True, slots=True)
class OsmLine:
    """A way vehicles can travel on, with its nodes in both coordinate systems."""

    osm_id: int
    kind: NetworkKind
    node_ids: IntArray
    longitudes: FloatArray
    latitudes: FloatArray
    eastings: FloatArray
    northings: FloatArray
    is_tunnel: bool = False
    is_bridge: bool = False
    name: str | None = None
    ropeway: Ropeway | None = None
    support_heights_m: FloatArray | None = None
    """Per node of a ropeway: the height of the pylon standing there, 0 where there is none."""


@dataclass(frozen=True, slots=True)
class OsmArea:
    """A polygon in WGS84 degrees (x = longitude, y = latitude)."""

    name: str
    geometry: shapely.MultiPolygon = field(repr=False)


@dataclass(frozen=True, slots=True)
class OsmExtract:
    lines: list[OsmLine]
    country: OsmArea | None


def classify_line(tags: Mapping[str, str]) -> NetworkKind | None:
    """The network a way belongs to, or None if vehicles of this project don't use it."""
    if (railway := tags.get("railway")) in RAILWAY_KINDS:
        is_rack = tags.get("rack") not in (None, "no") or "railway:rack" in tags
        kind = RAILWAY_KINDS[str(railway)]
        return "mountain_rail" if is_rack and kind == "rail" else kind
    if tags.get("route") == "ferry":
        return "ferry"
    if tags.get("aerialway") in ROPEWAY_KINDS:
        return "aerialway"
    return None


def is_switzerland(tags: Mapping[str, str]) -> bool:
    return (
        tags.get("boundary") == "administrative"
        and tags.get("admin_level") == "2"
        and tags.get("ISO3166-1") == SWITZERLAND_ISO_CODE
    )


def first_name(tags: Mapping[str, str]) -> str | None:
    return next((tags[key] for key in NAME_TAGS if key in tags), None)


def read_osm(
    pbf_path: Path, *, kinds: frozenset[NetworkKind], with_border: bool = False
) -> OsmExtract:
    """Network lines of the given kinds, and (if asked) the national border."""
    lines: list[OsmLine] = []
    country: OsmArea | None = None
    for record in _records(pbf_path, kinds=kinds, with_border=with_border):
        if isinstance(record, OsmLine):
            lines.append(record)
        else:
            country = record
    return OsmExtract(lines=lines, country=country)


def _records(
    pbf_path: Path, *, kinds: frozenset[NetworkKind], with_border: bool
) -> Iterator[OsmLine | OsmArea]:
    keys = (*NETWORK_KEYS, BORDER_KEY) if with_border else NETWORK_KEYS
    processor = (
        osmium.FileProcessor(str(pbf_path))
        .with_locations()
        .with_filter(osmium.filter.KeyFilter(*keys))
    )
    if with_border:
        processor = processor.with_areas(osmium.filter.TagFilter(("boundary", "administrative")))
    wkb = WKBFactory()
    # A PBF file lists nodes before ways, so every pylon is known by the time its ropeway comes.
    pylon_heights: dict[int, float | None] = {}
    for obj in processor:
        if isinstance(obj, osmium.osm.Node):
            if obj.tags.get("aerialway") == "pylon":
                pylon_heights[obj.id] = _metres(obj.tags.get("height"))
        elif isinstance(obj, osmium.osm.Way):
            line = _line(obj, kinds, pylon_heights)
            if line is not None:
                yield line
        elif isinstance(obj, osmium.osm.Area) and is_switzerland(dict(obj.tags)):
            yield _area(obj, wkb)


def _line(
    way: osmium.osm.Way, kinds: frozenset[NetworkKind], pylon_heights: Mapping[int, float | None]
) -> OsmLine | None:
    tags = dict(way.tags)
    kind = classify_line(tags)
    if kind is None or kind not in kinds:
        return None
    located = [node for node in way.nodes if node.location.valid()]
    if len(located) < MIN_POINTS_PER_LINE:
        return None
    latitudes = np.array([node.lat for node in located])
    longitudes = np.array([node.lon for node in located])
    eastings, northings = lv95_from_wgs84_arrays(latitudes, longitudes)
    ropeway = ROPEWAY_KINDS.get(tags.get("aerialway", "")) if kind == "aerialway" else None
    supports = None
    if ropeway is not None:
        default_m = DEFAULT_PYLON_HEIGHT_M[ropeway]
        supports = np.array(
            [
                (pylon_heights[node.ref] or default_m) if node.ref in pylon_heights else 0.0
                for node in located
            ]
        )
    return OsmLine(
        osm_id=way.id,
        kind=kind,
        node_ids=np.array([node.ref for node in located], dtype=np.int64),
        longitudes=longitudes,
        latitudes=latitudes,
        eastings=eastings,
        northings=northings,
        is_tunnel=tags.get("tunnel") == "yes",
        is_bridge=tags.get("bridge") not in (None, "no"),
        name=first_name(tags),
        ropeway=ropeway,
        support_heights_m=supports,
    )


def _area(area: osmium.osm.Area, wkb: WKBFactory) -> OsmArea:
    geometry = shapely.from_wkb(wkb.create_multipolygon(area))
    if isinstance(geometry, shapely.Polygon):
        geometry = shapely.MultiPolygon([geometry])
    if not isinstance(geometry, shapely.MultiPolygon):
        raise ValueError(f"OSM area {area.id} is not a polygon")
    return OsmArea(name=SWITZERLAND_ISO_CODE, geometry=geometry)


def _metres(value: str | None) -> float | None:
    """A height tag ("25", "25 m") in metres, or None when missing or unreadable."""
    if value is None:
        return None
    try:
        return float(value.strip().removesuffix("m").strip())
    except ValueError:
        return None
