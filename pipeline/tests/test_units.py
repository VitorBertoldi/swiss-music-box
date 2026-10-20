from pathlib import Path

import pytest
from conftest import FakeElevation

from smb_pipeline.elevation import CachedElevation
from smb_pipeline.geo import (
    LatLon,
    Place,
    flat_lonlat,
    lv95_easting,
    lv95_northing,
    simplify_indices,
)
from smb_pipeline.modes import layer_of


def test_lv95_origin_is_the_old_bern_observatory() -> None:
    lat, lon = 46.95108, 7.43864
    assert lv95_easting(lat, lon) == pytest.approx(2_600_000, abs=5)
    assert lv95_northing(lat, lon) == pytest.approx(1_200_000, abs=5)


@pytest.mark.parametrize(
    ("route_type", "layer"),
    [
        (102, "long_rail"),
        (116, "mountain_rail"),
        (109, "regional_rail"),
        (1300, "aerial"),
        (1400, "funicular"),
        (1000, "boat"),
        (900, "tram"),
        (401, "tram"),
        (700, "bus"),
        (1500, None),
    ],
)
def test_layer_of(route_type: int, layer: str | None) -> None:
    assert layer_of(route_type) == layer


def test_elevation_cache_only_asks_for_unknown_points(tmp_path: Path) -> None:
    inner = FakeElevation()
    cache_file = tmp_path / "elevation.json"
    a, b = LatLon(46.5, 8.0), LatLon(47.0, 8.0)

    assert CachedElevation(inner, cache_file).elevations([a]) == [500.0]
    assert CachedElevation(inner, cache_file).elevations([a, b]) == [500.0, 1000.0]
    assert inner.requests == [[a], [b]]


def test_simplify_keeps_corners_and_drops_points_on_a_straight_line() -> None:
    eastings = [0.0, 50.0, 100.0, 100.0, 100.0]
    northings = [0.0, 0.3, 0.0, 50.0, 100.0]  # 0.3 m wobble, then a right angle
    assert simplify_indices(eastings, northings, tolerance_m=1.0) == [0, 2, 4]
    assert simplify_indices(eastings, northings, tolerance_m=0.1) == [0, 1, 2, 4]


def test_wgs84_output_keeps_centimetre_precision() -> None:
    bern = Place(2_600_000, 1_200_000, 7.438632495, 46.951082877)
    assert flat_lonlat([bern]) == [7.4386325, 46.9510829]
