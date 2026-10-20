"""The shaded relief under the map: Copernicus terrain, cut to Switzerland's OSM border.

The image is laid out on the Web Mercator grid the map tiles use, so each pixel sits
exactly where the map expects it at every zoom level.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy as np
import shapely
from PIL import Image, ImageDraw, ImageFilter

from smb_pipeline.contract import Relief
from smb_pipeline.dem import HeightModel, hillshade
from smb_pipeline.geo import (
    EARTH_RADIUS_M,
    WGS84_DECIMALS,
    FloatArray,
    latitude_from_mercator_y,
    mercator_y,
)
from smb_pipeline.osm import OsmArea, read_osm

# About one projector pixel at national scale; closer in, the map's land use takes over.
RELIEF_PIXEL_M: Final = 100.0
# The relief stops at the border with a soft edge rather than a hard cut.
BORDER_FEATHER_PX: Final = 3
MARGIN_DEGREES: Final = 0.05
ATTRIBUTION: Final = "Relief © Copernicus DEM GLO-90 (ESA); border © OpenStreetMap contributors"


@dataclass(frozen=True, slots=True)
class MercatorGrid:
    """Pixel centres of an image covering west..east, south..north on Web Mercator."""

    longitudes: FloatArray
    latitudes: FloatArray
    """Per row, north to south."""
    pixel_size_m: FloatArray
    """Ground size of a pixel, per row."""
    west: float
    east: float
    north_y: float
    """Web Mercator y of the top edge (unit sphere)."""
    step_y: float

    def pixel_of(self, longitude: float, latitude: float) -> tuple[float, float]:
        column = (longitude - self.west) / (self.east - self.west) * len(self.longitudes)
        row = (self.north_y - float(mercator_y(np.array([latitude]))[0])) / self.step_y
        return column, row


def mercator_grid(
    west: float, south: float, east: float, north: float, pixel_size_m: float
) -> MercatorGrid:
    """A grid whose pixels are about `pixel_size_m` wide in the middle of the area."""
    middle_latitude = np.radians((south + north) / 2)
    step = pixel_size_m / (EARTH_RADIUS_M * np.cos(middle_latitude))  # radians of longitude
    columns = max(1, round(np.radians(east - west) / step))
    north_y = float(mercator_y(np.array([north]))[0])
    south_y = float(mercator_y(np.array([south]))[0])
    rows = max(1, round((north_y - south_y) / step))
    step_y = (north_y - south_y) / rows
    row_centres = north_y - (np.arange(rows) + 0.5) * step_y
    latitudes = latitude_from_mercator_y(row_centres)
    longitudes = west + (np.arange(columns) + 0.5) * (east - west) / columns
    return MercatorGrid(
        longitudes=longitudes,
        latitudes=latitudes,
        pixel_size_m=step_y * EARTH_RADIUS_M * np.cos(np.radians(latitudes)),
        west=west,
        east=east,
        north_y=north_y,
        step_y=step_y,
    )


def build_relief(pbf_path: Path, terrain: HeightModel, image_path: Path) -> Relief:
    """Renders the relief of Switzerland to `image_path` and describes where it goes."""
    country = read_osm(pbf_path, kinds=frozenset(), with_border=True).country
    if country is None:
        raise ValueError(f"no Swiss national border in {pbf_path}")
    west, south, east, north = country.geometry.bounds
    grid = mercator_grid(
        west - MARGIN_DEGREES,
        south - MARGIN_DEGREES,
        east + MARGIN_DEGREES,
        north + MARGIN_DEGREES,
        RELIEF_PIXEL_M,
    )
    latitudes, longitudes = np.meshgrid(grid.latitudes, grid.longitudes, indexing="ij")
    image = clip_to_area(
        hillshade(terrain.heights(latitudes, longitudes), grid.pixel_size_m), country, grid
    )
    image.save(image_path, optimize=True)
    south_edge = float(
        latitude_from_mercator_y(np.array([grid.north_y - grid.step_y * len(grid.latitudes)]))[0]
    )
    north_edge = float(latitude_from_mercator_y(np.array([grid.north_y]))[0])
    return Relief(
        image=image_path.name,
        west=round(grid.west, WGS84_DECIMALS),
        south=round(south_edge, WGS84_DECIMALS),
        east=round(grid.east, WGS84_DECIMALS),
        north=round(north_edge, WGS84_DECIMALS),
        attribution=ATTRIBUTION,
    )


def clip_to_area(relief: Image.Image, area: OsmArea, grid: MercatorGrid) -> Image.Image:
    """The relief with everything outside `area` made transparent (greyscale + alpha)."""
    mask = Image.new("L", relief.size, 0)
    draw = ImageDraw.Draw(mask)

    def to_pixels(ring: shapely.LinearRing) -> list[tuple[float, float]]:
        return [grid.pixel_of(longitude, latitude) for longitude, latitude in ring.coords]

    for polygon in area.geometry.geoms:
        draw.polygon(to_pixels(polygon.exterior), fill=255)
        for hole in polygon.interiors:
            draw.polygon(to_pixels(hole), fill=0)
    clipped = relief.convert("LA")
    clipped.putalpha(mask.filter(ImageFilter.GaussianBlur(BORDER_FEATHER_PX)))
    return clipped
