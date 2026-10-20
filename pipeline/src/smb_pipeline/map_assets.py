"""Static files the map needs besides the tiles: label glyphs and low-zoom overview tiles.

Both are protobuf files. For hosts that only serve common web types they are also written as
`AssetBundle` JSON files (one per tile zoom level, one for all glyphs).
"""

import base64
import gzip
import math
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression

from smb_pipeline.contract import AssetBundle

FONT_STACKS: Final = ("Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic")
# Unicode blocks Swiss place and street names use: Latin with accents (0-511), the
# spacing modifiers (512-767), combining marks (768-1023) and dashes and quotes (8192-8447).
GLYPH_RANGES: Final = ("0-255", "256-511", "512-767", "768-1023", "8192-8447")
# Shared-link overview: deep enough to see cities and lakes, few enough files to publish.
OVERVIEW_MAX_ZOOM: Final = 10
MAX_WEB_MERCATOR_LATITUDE: Final = 85.051129


@dataclass(frozen=True, slots=True)
class TileRange:
    """Inclusive tile x/y ranges covering an area at one zoom level."""

    zoom: int
    min_x: int
    max_x: int
    min_y: int
    max_y: int

    def tiles(self) -> list[tuple[int, int, int]]:
        return [
            (self.zoom, x, y)
            for x in range(self.min_x, self.max_x + 1)
            for y in range(self.min_y, self.max_y + 1)
        ]


def tile_range(zoom: int, west: float, south: float, east: float, north: float) -> TileRange:
    """The XYZ (slippy map) tiles covering a longitude/latitude box."""
    min_x, min_y = _tile_of(zoom, west, north)
    max_x, max_y = _tile_of(zoom, east, south)
    return TileRange(zoom, min_x, max_x, min_y, max_y)


def _tile_of(zoom: int, longitude: float, latitude: float) -> tuple[int, int]:
    tiles_per_side = 2**zoom
    latitude = max(-MAX_WEB_MERCATOR_LATITUDE, min(MAX_WEB_MERCATOR_LATITUDE, latitude))
    x = (longitude + 180) / 360 * tiles_per_side
    mercator = math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))
    y = (1 - mercator / math.pi) / 2 * tiles_per_side
    return min(tiles_per_side - 1, int(x)), min(tiles_per_side - 1, int(y))


def write_overview_tiles(
    pmtiles_path: Path,
    out_dir: Path,
    area: tuple[float, float, float, float],
    max_zoom: int = OVERVIEW_MAX_ZOOM,
) -> int:
    """Bundles tiles 0..max_zoom over `area` (west, south, east, north), one file per zoom.

    Writes `zoom-<z>.json` bundles with entries named "x/y", uncompressed (gzip is the
    transport's job). Returns the number of tiles written.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    with pmtiles_path.open("rb") as source_file:
        reader = Reader(MmapSource(source_file))
        is_gzipped = reader.header()["tile_compression"] == Compression.GZIP
        for zoom in range(max_zoom + 1):
            entries: dict[str, bytes] = {}
            for z, x, y in tile_range(zoom, *area).tiles():
                data = reader.get(z, x, y)
                if data:
                    entries[f"{x}/{y}"] = gzip.decompress(data) if is_gzipped else data
            _write_bundle(out_dir / f"zoom-{zoom}.json", entries)
            written += len(entries)
    return written


def extract_fonts(zip_path: Path, out_dir: Path) -> int:
    """Unpacks the glyph files the map style uses, and bundles them into `glyphs.json`.

    Returns the number of glyph files.
    """
    entries: dict[str, bytes] = {}
    with zipfile.ZipFile(zip_path) as archive:
        for stack in FONT_STACKS:
            for glyph_range in GLYPH_RANGES:
                data = archive.read(f"{stack}/{glyph_range}.pbf")
                target = out_dir / stack / f"{glyph_range}.pbf"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                entries[f"{stack}/{glyph_range}"] = data
    _write_bundle(out_dir / "glyphs.json", entries)
    return len(entries)


def _write_bundle(path: Path, entries: dict[str, bytes]) -> None:
    bundle = AssetBundle(
        entries={name: base64.b64encode(data).decode("ascii") for name, data in entries.items()}
    )
    path.write_text(bundle.model_dump_json())
