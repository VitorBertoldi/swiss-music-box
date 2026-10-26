import pytest
from conftest import MINI_GTFS, MINI_OSM, SERVICE_DATE, FakeElevation, FakeTerrain

from smb_pipeline.build import build_day
from smb_pipeline.explore import Findings, explore


@pytest.fixture(scope="module")
def findings() -> Findings:
    return explore(
        build_day(
            MINI_GTFS, MINI_OSM, SERVICE_DATE, FakeElevation(), FakeTerrain(), texture_bins=4
        ).day
    )


def test_departures_are_counted_per_hour(findings: Findings) -> None:
    assert findings.departures_per_hour["aerial"][8] == 3
    assert findings.departures_per_hour["bus"][23] == 1
    assert findings.departures_per_hour["bus"][0] == 1


def test_pulse_ratio_compares_half_hours_with_an_average_minute(findings: Findings) -> None:
    # The IC departs at 08:00, 08:30 and 10:00: all on :00/:30, so the ratio is 60 / 2 = 30.
    assert findings.pulse_ratio["long_rail"] == 30.0
    assert findings.pulse_ratio["boat"] == 0.0


def test_tunnels_are_summed_per_hour(findings: Findings) -> None:
    base_tunnel = findings.tunnel_train_minutes_per_hour["Test-Basistunnel"]
    busy_hours = [hour for hour, minutes in enumerate(base_tunnel) if minutes]
    assert busy_hours and set(busy_hours) <= {8, 9}
