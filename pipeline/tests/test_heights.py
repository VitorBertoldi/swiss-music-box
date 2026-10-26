import numpy as np
import pytest
from test_network import line

from smb_pipeline.geo import FloatArray
from smb_pipeline.heights import (
    CLEARANCE_M,
    MIN_ROPE_CLEARANCE_M,
    STATION_ROPE_HEIGHT_M,
    HeightProfiler,
    across_structures,
    fill_dips,
    rope_heights,
    smoothed,
)
from smb_pipeline.network import build_network
from smb_pipeline.routing import NetworkRouter, StopPair

WEST, NORTH = 2_600_000.0, 1_200_000.0


class Valley:
    """Flat ground at 500 m with a 60 m deep valley between 2 and 3 km east of WEST."""

    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        from smb_pipeline.geo import lv95_from_wgs84_arrays

        eastings, _ = lv95_from_wgs84_arrays(latitudes, longitudes)
        in_valley = (eastings > WEST + 2_000) & (eastings < WEST + 3_000)
        return np.where(in_valley, 440.0, 500.0)


def test_smoothing_averages_within_the_window() -> None:
    along = np.arange(0, 100, 10, dtype=np.float64)
    heights = np.array([0, 0, 0, 0, 0, 10, 10, 10, 10, 10], dtype=np.float64)
    result = smoothed(heights, along, window_m=20)
    assert result[0] == 0 and result[-1] == 10
    assert 0 < result[4] < result[5] < 10


def test_a_structure_runs_straight_between_its_ends() -> None:
    along = np.array([0, 10, 20, 30, 40], dtype=np.float64)
    heights = np.array([100, 50, 0, 50, 140], dtype=np.float64)
    result = across_structures(heights, along, [None, "bridge", "bridge", None])
    assert list(result) == pytest.approx([100, 50, 50, 50, 140])


def test_dips_are_filled_to_the_steepest_grade() -> None:
    along = np.arange(0, 500, 100, dtype=np.float64)
    heights = np.array([100, 100, 0, 100, 100], dtype=np.float64)
    assert list(fill_dips(heights, along, 0.05)) == pytest.approx([100, 100, 95, 100, 100])


def test_a_bridge_crosses_the_valley_level_while_plain_track_follows_the_ground() -> None:
    xs = [0, 1_000, 1_900, 3_100, 4_000, 5_000]
    track = line([(WEST + x, NORTH) for x in xs[:3]], [1, 2, 3])
    viaduct = line([(WEST + x, NORTH) for x in xs[2:4]], [3, 4], is_bridge=True)
    beyond = line([(WEST + x, NORTH) for x in xs[3:]], [4, 5, 6])
    graph = build_network([track, viaduct, beyond])
    router = NetworkRouter(graph, "track")
    start, end = graph.place_of(0), graph.place_of(5)
    path = router.route_all([StopPair("a", "b")], {"a": start, "b": end})[StopPair("a", "b")]
    profile = HeightProfiler(Valley(), {"track": graph}).profile(path, "long_rail", tolerance_m=1.0)
    eastings = [place.easting_m - WEST for place in profile.places]
    by_east = dict(zip(eastings, profile.heights_m, strict=True))
    mid_valley = min(by_east, key=lambda x: abs(x - 2_500))
    assert by_east[mid_valley] == pytest.approx(500 + CLEARANCE_M, abs=1)
    assert all(h >= 500 for h in profile.heights_m)


def test_boats_float_at_the_lake_level() -> None:
    graph = build_network([line([(WEST, NORTH), (WEST + 5_000, NORTH)], [1, 2])])
    router = NetworkRouter(graph, "ferry_route")
    path = router.route_all([StopPair("a", "b")], {"a": graph.place_of(0), "b": graph.place_of(1)})[
        StopPair("a", "b")
    ]
    profile = HeightProfiler(Valley(), {"track": graph}).profile(path, "boat", tolerance_m=1.0)
    assert set(profile.heights_m) == {440.0}


class Hill(Valley):
    """Flat ground at 500 m with a 60 m high hill between 2 and 3 km east of WEST."""

    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        return 1000 - super().heights(latitudes, longitudes)  # 500 stays 500, 440 becomes 560


def test_a_tunnel_runs_straight_under_the_hill_without_being_lifted_onto_it() -> None:
    xs = [0, 1_000, 1_900, 3_100, 4_000, 5_000]
    graph = build_network(
        [
            line([(WEST + x, NORTH) for x in xs[:3]], [1, 2, 3]),
            line([(WEST + x, NORTH) for x in xs[2:4]], [3, 4], is_tunnel=True),
            line([(WEST + x, NORTH) for x in xs[3:]], [4, 5, 6]),
        ]
    )
    router = NetworkRouter(graph, "track")
    places = {"a": graph.place_of(0), "b": graph.place_of(5)}
    path = router.route_all([StopPair("a", "b")], places)[StopPair("a", "b")]
    profile = HeightProfiler(Hill(), {"track": graph}).profile(path, "long_rail", tolerance_m=1.0)
    assert max(profile.heights_m) == pytest.approx(500 + CLEARANCE_M, abs=0.5)


class Flat:
    """Level ground at 1000 m."""

    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        return 1000 + 0 * latitudes + 0 * longitudes


def test_a_rope_runs_over_its_pylons_and_sags_between_them() -> None:
    xs = [0, 1_000, 2_000]
    rope = line([(WEST + x, NORTH) for x in xs], [1, 2, 3], supports_m=[0, 40, 0])
    graph = build_network([rope])
    places = {"a": graph.place_of(0), "b": graph.place_of(2)}
    path = NetworkRouter(graph, "rope").route_all([StopPair("a", "b")], places)[StopPair("a", "b")]
    profile = HeightProfiler(Flat(), {"rope": graph}).profile(path, "aerial", tolerance_m=1.0)
    by_east = dict(
        zip([p.easting_m - WEST for p in profile.places], profile.heights_m, strict=True)
    )
    assert by_east[0] == pytest.approx(1000 + STATION_ROPE_HEIGHT_M)
    assert by_east[1_000] == pytest.approx(1040)
    assert min(profile.heights_m) >= 1000 + MIN_ROPE_CLEARANCE_M
    assert profile.ropeway == "cable_car"
    assert [round(p.place.easting_m - WEST) for p in profile.pylons] == [1_000]
    assert profile.pylons[0].base_m == pytest.approx(1000)


def test_rope_heights_sag_most_in_the_middle_of_a_span() -> None:
    along = np.arange(0, 1_001, 100, dtype=np.float64)
    heights = rope_heights(along, [0, 10], {0: 100.0, 10: 100.0})
    assert heights[0] == heights[-1] == 100
    assert heights[5] == pytest.approx(100 - 30)  # 3 % of a 1 km span
