import pytest
from conftest import MINI_GTFS, MINI_OSM, SERVICE_DATE, FakeElevation

from smb_pipeline.build import build_day
from smb_pipeline.contract import Motion
from smb_pipeline.motion import tunnel_occupancy


@pytest.fixture(scope="module")
def motion() -> Motion:
    return build_day(MINI_GTFS, MINI_OSM, SERVICE_DATE, FakeElevation()).motion


def _trip_legs(motion: Motion, trip: int) -> list[int]:
    first = motion.trips.first_leg[trip]
    return list(range(first, first + motion.trips.leg_count[trip]))


def test_each_moving_trip_is_kept_with_its_legs_in_order(motion: Motion) -> None:
    # IC Alpha-Beta-Gamma, three cable-car runs, IC to Praha (leaves the map: no legs left).
    assert sorted(motion.trips.layer) == ["aerial", "aerial", "aerial", "long_rail"]
    ic = motion.trips.layer.index("long_rail")
    departures = [motion.legs.depart_minute[leg] for leg in _trip_legs(motion, ic)]
    assert departures == [8 * 60, 8 * 60 + 30]


def test_the_ic_follows_the_osm_track_through_the_base_tunnel(motion: Motion) -> None:
    ic = motion.trips.layer.index("long_rail")
    beta_to_gamma = _trip_legs(motion, ic)[1]
    segment = motion.segments[motion.legs.segment[beta_to_gamma]]
    assert segment.route == "track"
    assert [motion.tunnels[passage.tunnel].name for passage in segment.tunnels] == [
        "Test-Basistunnel"
    ]
    passage = segment.tunnels[0]
    assert 0 < passage.start_fraction < passage.end_fraction < 1


def test_cable_cars_travel_in_straight_lines(motion: Motion) -> None:
    cable_car = motion.trips.layer.index("aerial")
    leg = _trip_legs(motion, cable_car)[0]
    segment = motion.segments[motion.legs.segment[leg]]
    assert segment.route == "straight"
    assert len(segment.coordinates) == 4


def test_tunnel_occupancy_counts_one_train(motion: Motion) -> None:
    occupancy = tunnel_occupancy(motion)
    base = next(i for i, tunnel in enumerate(motion.tunnels) if tunnel.id == "test-basistunnel")
    assert max(occupancy[base]) == 1


def test_segments_are_stored_in_wgs84_with_an_overview_subset(motion: Motion) -> None:
    for segment in motion.segments:
        longitudes = segment.coordinates[0::2]
        latitudes = segment.coordinates[1::2]
        assert all(5.9 < longitude < 10.6 for longitude in longitudes)
        assert all(45.8 < latitude < 47.9 for latitude in latitudes)
        overview = list(
            zip(segment.overview_coordinates[0::2], segment.overview_coordinates[1::2], strict=True)
        )
        precise = set(zip(longitudes, latitudes, strict=True))
        assert set(overview) <= precise
        assert overview[0] == (longitudes[0], latitudes[0])
