import numpy as np
import pytest
import shapely
from PIL import Image

from smb_pipeline.osm import OsmArea
from smb_pipeline.relief import clip_to_area, mercator_grid


def test_mercator_grid_pixels_have_the_requested_ground_size() -> None:
    grid = mercator_grid(west=7.0, south=46.0, east=8.0, north=47.0, pixel_size_m=1000)
    assert grid.pixel_size_m.mean() == pytest.approx(1000, rel=0.02)
    assert len(grid.longitudes) == pytest.approx(76, abs=1)  # one degree of longitude at 46.5°


def test_mercator_rows_get_shorter_towards_the_pole() -> None:
    grid = mercator_grid(west=7.0, south=46.0, east=8.0, north=47.0, pixel_size_m=1000)
    assert grid.latitudes[0] > grid.latitudes[-1]  # rows run north to south
    assert grid.pixel_size_m[0] < grid.pixel_size_m[-1]


def test_relief_is_transparent_outside_the_country() -> None:
    grid = mercator_grid(west=7.0, south=46.0, east=7.4, north=46.3, pixel_size_m=1000)
    relief = Image.new("L", (len(grid.longitudes), len(grid.latitudes)), 200)
    western_half = shapely.MultiPolygon([shapely.box(7.0, 46.0, 7.2, 46.3)])
    alpha = np.asarray(clip_to_area(relief, OsmArea("CH", western_half), grid))[:, :, 1]
    middle_row = len(grid.latitudes) // 2
    assert alpha[middle_row, 2] > 250  # well inside
    assert alpha[middle_row, -3] < 5  # well outside
