import json

import pytest
from conftest import MINI_GTFS, MINI_OSM, SERVICE_DATE, FakeElevation, FakeTerrain
from pydantic import ValidationError

from smb_pipeline.build import DayBuild, build_day
from smb_pipeline.contract import Day, Motion, NoteEvents


@pytest.fixture(scope="module")
def build() -> DayBuild:
    return build_day(
        MINI_GTFS, MINI_OSM, SERVICE_DATE, FakeElevation(), FakeTerrain(), texture_bins=4
    )


def test_note_stations_are_those_with_sparse_layer_departures(build: DayBuild) -> None:
    assert [station.name for station in build.day.stations] == ["Alpha", "Beta"]
    assert build.day.stations[0].elevation_m == pytest.approx(951.1, abs=0.1)


def test_notes_are_sorted_and_flag_trip_starts(build: DayBuild) -> None:
    notes = build.day.notes
    rows = list(zip(notes.minute, notes.station, notes.layer, notes.trip_start, strict=True))
    assert rows == [
        (480, 0, "aerial", True),
        (480, 0, "long_rail", True),
        (500, 0, "aerial", True),
        (510, 1, "long_rail", False),
        (520, 0, "aerial", True),
        (600, 0, "long_rail", True),
    ]


def test_textures_bin_dense_layers_west_to_east(build: DayBuild) -> None:
    bus = next(texture for texture in build.day.textures if texture.layer == "bus")
    assert len(bus.counts) == build.day.minutes_per_day
    assert sum(map(sum, bus.counts)) == 2
    alpha_bin = bus.counts[23 * 60 + 50].index(1)
    beta_bin = bus.counts[10].index(1)
    assert alpha_bin < beta_bin  # Bern lies west of Arth-Goldau


def test_the_osm_base_tunnel_drones_while_the_ic_is_inside(build: DayBuild) -> None:
    tunnel = next(series for series in build.day.tunnels if series.id == "test-basistunnel")
    busy_minutes = [minute for minute, trains in enumerate(tunnel.occupancy) if trains]
    # The IC runs Beta 08:30 -> Gamma 09:25; the tunnel is a stretch in the middle.
    assert busy_minutes
    assert busy_minutes[0] > 8 * 60 + 30 and busy_minutes[-1] < 9 * 60 + 25


def test_routing_reports_track_pairs_and_stations_beyond_the_map(build: DayBuild) -> None:
    assert build.routing.pairs[("long_rail", "track")] == 2
    assert build.routing.pairs[("aerial", "straight")] == 1


@pytest.mark.parametrize("model", [Day, Motion])
def test_files_round_trip_through_json(build: DayBuild, model: type[Day] | type[Motion]) -> None:
    document = build.day if model is Day else build.motion
    assert model.model_validate(json.loads(document.model_dump_json())) == document


def test_note_columns_must_have_equal_length() -> None:
    with pytest.raises(ValidationError):
        NoteEvents(minute=[1, 2], station=[0], layer=["boat"], trip_start=[True])
