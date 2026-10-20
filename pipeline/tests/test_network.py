import numpy as np
import pytest

from smb_pipeline.geo import Place, wgs84_from_lv95_arrays
from smb_pipeline.network import build_network, find_long_tunnels
from smb_pipeline.osm import OsmLine
from smb_pipeline.routing import NetworkRouter, StopPair

_next_id = iter(range(1, 10_000))


def line(
    points: list[tuple[float, float]],
    node_ids: list[int],
    *,
    is_tunnel: bool = False,
    name: str | None = None,
) -> OsmLine:
    """A rail line through LV95 points; ways sharing a node id are connected."""
    eastings = np.array([point[0] for point in points], dtype=np.float64)
    northings = np.array([point[1] for point in points], dtype=np.float64)
    latitudes, longitudes = wgs84_from_lv95_arrays(eastings, northings)
    return OsmLine(
        osm_id=next(_next_id),
        kind="rail",
        node_ids=np.array(node_ids, dtype=np.int64),
        longitudes=longitudes,
        latitudes=latitudes,
        eastings=eastings,
        northings=northings,
        is_tunnel=is_tunnel,
        name=name,
    )


def place(easting: float, northing: float) -> Place:
    latitudes, longitudes = wgs84_from_lv95_arrays(np.array([easting]), np.array([northing]))
    return Place(easting, northing, float(longitudes[0]), float(latitudes[0]))


def name_near(easting: float, northing: float) -> str:
    return "Somewhere" if easting < 2_650_000 else "Elsewhere"


def test_parallel_tubes_with_one_name_are_one_tunnel() -> None:
    tube_a = line(
        [(2_600_000, 1_200_000), (2_605_000, 1_200_000)], [1, 2], is_tunnel=True, name="X"
    )
    tube_b = line(
        [(2_600_000, 1_200_030), (2_605_000, 1_200_030)], [3, 4], is_tunnel=True, name="X"
    )
    tunnels, tunnel_of_line = find_long_tunnels([tube_a, tube_b], name_near)
    assert [(tunnel.id, round(tunnel.length_m)) for tunnel in tunnels] == [("x", 5000)]
    assert tunnel_of_line == {tube_a.osm_id: 0, tube_b.osm_id: 0}


def test_namesakes_far_apart_stay_separate_tunnels() -> None:
    here = line([(2_600_000, 1_200_000), (2_604_000, 1_200_000)], [1, 2], is_tunnel=True, name="X")
    there = line([(2_700_000, 1_200_000), (2_704_000, 1_200_000)], [3, 4], is_tunnel=True, name="X")
    tunnels, _ = find_long_tunnels([here, there], name_near)
    assert [tunnel.id for tunnel in tunnels] == ["x", "x-2"]


def test_unnamed_tunnels_are_named_after_the_nearest_station() -> None:
    unnamed = line([(2_600_000, 1_200_000), (2_604_000, 1_200_000)], [1, 2], is_tunnel=True)
    tunnels, _ = find_long_tunnels([unnamed], name_near)
    assert tunnels[0].name == "Tunnel near Somewhere"


def test_short_tunnels_are_ignored() -> None:
    short = line([(2_600_000, 1_200_000), (2_601_000, 1_200_000)], [1, 2], is_tunnel=True, name="Y")
    assert find_long_tunnels([short], name_near) == ([], {})


@pytest.fixture
def router() -> NetworkRouter:
    approach = line([(2_600_000, 1_200_000), (2_610_000, 1_200_000)], [1, 2])
    tunnel = line(
        [(2_610_000, 1_200_000), (2_620_000, 1_200_000)], [2, 3], is_tunnel=True, name="Base"
    )
    exit_line = line([(2_620_000, 1_200_000), (2_625_000, 1_200_000)], [3, 4])
    return NetworkRouter(build_network([approach, tunnel, exit_line], name_near), "track")


POSITIONS = {
    "west": place(2_600_050, 1_200_040),  # 64 m from the track: snaps
    "east": place(2_625_000, 1_200_000),
    "east_twin": place(2_625_010, 1_200_000),  # snaps onto the same node as "east"
    "far_away": place(2_700_000, 1_300_000),  # beyond the network: outside the extract
}


def test_routes_along_the_track_and_records_the_tunnel_span(router: NetworkRouter) -> None:
    path = router.route_all([StopPair("west", "east")], POSITIONS)[StopPair("west", "east")]
    assert path.route == "track"
    assert path.length_m == pytest.approx(25_000)
    assert path.points[0].longitude == pytest.approx(7.43864, abs=1e-4)  # Bern, in degrees
    [span] = path.tunnel_spans
    assert (span.start_m, span.end_m) == pytest.approx((10_000, 20_000))


def test_stations_on_the_same_node_get_a_straight_line(router: NetworkRouter) -> None:
    pair = StopPair("east", "east_twin")
    assert router.route_all([pair], POSITIONS)[pair].route == "straight"


def test_pairs_beyond_the_extract_are_left_out(router: NetworkRouter) -> None:
    assert router.route_all([StopPair("west", "far_away")], POSITIONS) == {}
