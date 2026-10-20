from collections.abc import Iterator, Sequence
from datetime import date
from pathlib import Path

import duckdb
import pytest

from smb_pipeline import events, feed, stations
from smb_pipeline.geo import SWITZERLAND, LatLon

FIXTURES = Path(__file__).parent / "fixtures"
MINI_GTFS = FIXTURES / "mini_gtfs"
MINI_OSM = FIXTURES / "mini.osm"
SERVICE_DATE = date(2026, 10, 21)  # a Wednesday


class FakeElevation:
    """Elevation = 1000 m per degree of latitude above 46, recording every request."""

    def __init__(self) -> None:
        self.requests: list[list[LatLon]] = []

    def elevations(self, points: Sequence[LatLon]) -> list[float]:
        self.requests.append(list(points))
        return [round((p.lat - 46) * 1000, 1) for p in points]


@pytest.fixture
def connection() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect()
    feed.register_feed(connection, MINI_GTFS)
    feed.materialize_service_day(connection, SERVICE_DATE)
    stations.materialize_parents(connection, SWITZERLAND)
    events.materialize_departures(connection)
    yield connection
    connection.close()
