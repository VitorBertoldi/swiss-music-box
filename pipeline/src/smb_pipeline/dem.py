"""Terrain from the Copernicus GLO-90 digital surface model (open data, 90 m, on AWS).

Used twice: station elevations (pitch) and the hillshade relief under the map.
Tiles are 1 x 1 degree GeoTIFFs; they are downloaded once and cached on disk.
"""

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import httpx
import numpy as np
import tifffile
from PIL import Image

from smb_pipeline.geo import FloatArray, LatLon

TILE_URL = "https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif"
PIXELS_PER_DEGREE = 1200  # 3 arc seconds, about 90 m (valid below 50° latitude)
MISSING_HEIGHT_M = 0.0  # tiles that are entirely sea are absent from the bucket

# Light from the north-west at 45°: the cartographic convention, so valleys read as valleys.
LIGHT_AZIMUTH_DEG = 315
LIGHT_ALTITUDE_DEG = 45
# The Alps look flat from 350 km away; exaggerating relief keeps them readable on screen.
RELIEF_EXAGGERATION = 2.0


def tile_name(south_lat: int, west_lon: int) -> str:
    lat_part = f"{'N' if south_lat >= 0 else 'S'}{abs(south_lat):02d}_00"
    lon_part = f"{'E' if west_lon >= 0 else 'W'}{abs(west_lon):03d}_00"
    return f"Copernicus_DSM_COG_30_{lat_part}_{lon_part}_DEM"


class HeightModel(Protocol):
    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        """Terrain height in metres at each point."""
        ...


class CopernicusDem:
    """Height lookups over a set of cached Copernicus tiles."""

    def __init__(self, cache_dir: Path, client: httpx.Client | None = None) -> None:
        self._cache_dir = cache_dir
        self._client = client or httpx.Client(timeout=60, follow_redirects=True)
        self._tiles: dict[tuple[int, int], FloatArray | None] = {}

    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        """Height in metres at each point (nearest pixel)."""
        heights = np.full(latitudes.shape, MISSING_HEIGHT_M)
        south_edges = np.floor(latitudes).astype(int)
        west_edges = np.floor(longitudes).astype(int)
        for south_lat, west_lon in set(zip(south_edges.flat, west_edges.flat, strict=True)):
            tile = self._tile(int(south_lat), int(west_lon))
            if tile is None:
                continue
            inside = (south_edges == south_lat) & (west_edges == west_lon)
            # Row 0 is the tile's northern edge.
            rows = ((south_lat + 1 - latitudes[inside]) * PIXELS_PER_DEGREE).astype(int)
            cols = ((longitudes[inside] - west_lon) * PIXELS_PER_DEGREE).astype(int)
            heights[inside] = tile[
                np.clip(rows, 0, tile.shape[0] - 1), np.clip(cols, 0, tile.shape[1] - 1)
            ]
        return heights

    def smooth_heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        """Height in metres at each point, blended between the four nearest pixel centres.

        For surfaces drawn finer than the 90 m source (3D terrain), where nearest-pixel
        lookups would show as steps. Near a tile's edge the blend stays inside that tile.
        """
        heights = np.full(latitudes.shape, MISSING_HEIGHT_M)
        south_edges = np.floor(latitudes).astype(int)
        west_edges = np.floor(longitudes).astype(int)
        for south_lat, west_lon in set(zip(south_edges.flat, west_edges.flat, strict=True)):
            tile = self._tile(int(south_lat), int(west_lon))
            if tile is None:
                continue
            inside = (south_edges == south_lat) & (west_edges == west_lon)
            # Fractional pixel position, measured between pixel centres; row 0 is north.
            rows = (south_lat + 1 - latitudes[inside]) * PIXELS_PER_DEGREE - 0.5
            cols = (longitudes[inside] - west_lon) * PIXELS_PER_DEGREE - 0.5
            last_row, last_col = tile.shape[0] - 1, tile.shape[1] - 1
            row0 = np.clip(np.floor(rows).astype(int), 0, last_row)
            col0 = np.clip(np.floor(cols).astype(int), 0, last_col)
            row1 = np.minimum(row0 + 1, last_row)
            col1 = np.minimum(col0 + 1, last_col)
            down = np.clip(rows - row0, 0, 1)
            right = np.clip(cols - col0, 0, 1)
            top = tile[row0, col0] * (1 - right) + tile[row0, col1] * right
            bottom = tile[row1, col0] * (1 - right) + tile[row1, col1] * right
            heights[inside] = top * (1 - down) + bottom * down
        return heights

    def _tile(self, south_lat: int, west_lon: int) -> FloatArray | None:
        key = (south_lat, west_lon)
        if key not in self._tiles:
            path = self._download(tile_name(south_lat, west_lon))
            self._tiles[key] = None if path is None else tifffile.imread(path).astype(np.float64)
        return self._tiles[key]

    def _download(self, name: str) -> Path | None:
        path = self._cache_dir / f"{name}.tif"
        missing_marker = path.with_suffix(".missing")
        if path.exists():
            return path
        if missing_marker.exists():
            return None
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        response = self._client.get(TILE_URL.format(name=name))
        if response.status_code == httpx.codes.NOT_FOUND:
            missing_marker.touch()
            return None
        response.raise_for_status()
        path.write_bytes(response.content)
        return path


class SmoothedDem:
    """`HeightModel` that blends between pixels: for surfaces drawn finer than 90 m."""

    def __init__(self, dem: CopernicusDem) -> None:
        self._dem = dem

    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        return self._dem.smooth_heights(latitudes, longitudes)


class DemElevation:
    """`ElevationProvider` backed by local DEM tiles: no network after the first run."""

    def __init__(self, terrain: HeightModel) -> None:
        self._terrain = terrain

    def elevations(self, points: Sequence[LatLon]) -> list[float]:
        latitudes = np.array([p.lat for p in points], dtype=np.float64)
        longitudes = np.array([p.lon for p in points], dtype=np.float64)
        return [round(float(h), 1) for h in self._terrain.heights(latitudes, longitudes)]


def hillshade(heights: FloatArray, pixel_size_m: FloatArray) -> Image.Image:
    """Greyscale relief of a height grid whose rows run north to south.

    `pixel_size_m` gives the ground size of a (square) pixel for each row; on a Web Mercator
    grid it shrinks towards the pole.
    """
    exaggerated = heights * RELIEF_EXAGGERATION
    row_size = pixel_size_m[:, np.newaxis]
    # Rows run north to south, so the northward slope is minus the row gradient.
    slope_south = np.gradient(exaggerated, axis=0) / row_size
    slope_east = np.gradient(exaggerated, axis=1) / row_size
    normal = np.stack([-slope_east, slope_south, np.ones_like(exaggerated)])
    normal /= np.linalg.norm(normal, axis=0)
    light = _unit_light_vector(LIGHT_AZIMUTH_DEG, LIGHT_ALTITUDE_DEG)
    shade = np.clip(np.tensordot(light, normal, axes=1), 0, 1)
    return Image.fromarray((shade * 255).astype(np.uint8), mode="L")


def _unit_light_vector(azimuth_deg: float, altitude_deg: float) -> FloatArray:
    """(east, north, up) direction towards the sun; azimuth clockwise from north."""
    azimuth, altitude = math.radians(azimuth_deg), math.radians(altitude_deg)
    return np.array(
        [
            math.sin(azimuth) * math.cos(altitude),
            math.cos(azimuth) * math.cos(altitude),
            math.sin(altitude),
        ]
    )
