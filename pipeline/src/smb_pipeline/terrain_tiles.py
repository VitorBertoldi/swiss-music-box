"""Terrain tiles for the 3D map: heights encoded as Terrarium PNGs in one PMTiles file.

MapLibre raises the map over these tiles (`raster-dem` source, `encoding: "terrarium"`), and
vehicles placed at their true altitude then stand on the ground.
"""

import io
import math
from pathlib import Path
from typing import Final

import numpy as np
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from smb_pipeline.dem import HeightModel
from smb_pipeline.geo import FloatArray
from smb_pipeline.map_assets import tile_range

TILE_SIZE_PX: Final = 256
# At zoom 11 a pixel is ~50 m over Switzerland, already finer than the 90 m source; MapLibre
# stretches the deepest tiles further when zooming in.
TERRAIN_MAX_ZOOM: Final = 11
# Terrarium stores height + 32768 m as red * 256 + green + blue / 256.
TERRARIUM_OFFSET_M: Final = 32768.0
CHANNEL_LEVELS: Final = 256


def pixel_centres(zoom: int, x: int, y: int) -> tuple[FloatArray, FloatArray]:
    """Latitude and longitude of every pixel centre of an XYZ tile, as 256 x 256 grids."""
    tiles_per_side = 2**zoom
    offsets = (np.arange(TILE_SIZE_PX) + 0.5) / TILE_SIZE_PX
    longitudes = (x + offsets) / tiles_per_side * 360.0 - 180.0
    mercator = np.pi * (1 - 2 * (y + offsets) / tiles_per_side)
    latitudes = np.degrees(np.arctan(np.sinh(mercator)))
    latitude_grid, longitude_grid = np.meshgrid(latitudes, longitudes, indexing="ij")
    return latitude_grid, longitude_grid


def encode_terrarium(heights_m: FloatArray) -> Image.Image:
    """Heights in metres as a Terrarium RGB image (about 4 mm resolution)."""
    shifted = np.clip(heights_m + TERRARIUM_OFFSET_M, 0, CHANNEL_LEVELS**2 - 1 / CHANNEL_LEVELS)
    whole = np.floor(shifted)
    red = whole // CHANNEL_LEVELS
    green = whole % CHANNEL_LEVELS
    blue = np.floor((shifted - whole) * CHANNEL_LEVELS)
    rgb = np.stack([red, green, blue], axis=-1).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def decode_terrarium(image: Image.Image) -> FloatArray:
    """The inverse of `encode_terrarium`, as MapLibre computes it."""
    rgb = np.asarray(image, dtype=np.float64)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return red * CHANNEL_LEVELS + green + blue / CHANNEL_LEVELS - TERRARIUM_OFFSET_M


def write_terrain_tiles(
    terrain: HeightModel,
    out_path: Path,
    area: tuple[float, float, float, float],
    max_zoom: int = TERRAIN_MAX_ZOOM,
) -> int:
    """Writes Terrarium tiles for zoom 0..max_zoom over `area` (west, south, east, north).

    Returns the number of tiles written.
    """
    west, south, east, north = area
    tiles: list[tuple[int, bytes]] = []
    for zoom in range(max_zoom + 1):
        for z, x, y in tile_range(zoom, *area).tiles():
            latitudes, longitudes = pixel_centres(z, x, y)
            # Low-zoom tiles reach far beyond the area: there the nearest edge height is
            # repeated, so nothing outside is downloaded and the ground has no cliff at the edge.
            heights = terrain.heights(
                np.clip(latitudes, south, north), np.clip(longitudes, west, east)
            )
            png = io.BytesIO()
            encode_terrarium(heights).save(png, format="PNG")
            tiles.append((zxy_to_tileid(z, x, y), png.getvalue()))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("wb") as file:
        writer = Writer(file)
        for tile_id, data in sorted(tiles):
            writer.write_tile(tile_id, data)
        writer.finalize(
            {
                "tile_type": TileType.PNG,
                "tile_compression": Compression.NONE,
                "min_lon_e7": _e7(west),
                "min_lat_e7": _e7(south),
                "max_lon_e7": _e7(east),
                "max_lat_e7": _e7(north),
                "center_zoom": 8,
                "center_lon_e7": _e7((west + east) / 2),
                "center_lat_e7": _e7((south + north) / 2),
            },
            {"name": "Swiss Music Box terrain", "encoding": "terrarium"},
        )
    return len(tiles)


def _e7(degrees: float) -> int:
    return math.floor(degrees * 10_000_000)
