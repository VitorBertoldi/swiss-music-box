import pytest
from conftest import MINI_OSM

from smb_pipeline.osm import OsmExtract, classify_line, read_osm


@pytest.mark.parametrize(
    ("tags", "kind"),
    [
        ({"railway": "rail"}, "rail"),
        ({"railway": "rail", "rack": "riggenbach"}, "mountain_rail"),
        ({"railway": "narrow_gauge"}, "mountain_rail"),
        ({"railway": "funicular"}, "funicular"),
        ({"railway": "tram"}, None),
        ({"route": "ferry"}, "ferry"),
        ({"aerialway": "gondola"}, None),
        ({"highway": "motorway"}, None),
    ],
)
def test_classify_line(tags: dict[str, str], kind: str | None) -> None:
    assert classify_line(tags) == kind


@pytest.fixture(scope="module")
def extract() -> OsmExtract:
    return read_osm(MINI_OSM, kinds=frozenset({"rail", "mountain_rail", "funicular", "ferry"}))


def test_reads_tunnels_and_names(extract: OsmExtract) -> None:
    by_id = {line.osm_id: line for line in extract.lines}
    assert by_id[101].is_tunnel and by_id[101].name == "Test-Basistunnel"
    assert not by_id[100].is_tunnel
    assert by_id[105].kind == "mountain_rail" and by_id[105].name is None


def test_skips_ways_vehicles_do_not_use(extract: OsmExtract) -> None:
    ids = {line.osm_id for line in extract.lines}
    assert {110, 111, 130, 131}.isdisjoint(ids)  # cable car, drag lift, motorway, street


def test_keeps_exact_wgs84_and_projects_to_lv95(extract: OsmExtract) -> None:
    alpha_track = next(line for line in extract.lines if line.osm_id == 100)
    assert alpha_track.latitudes[0] == 46.95108
    assert alpha_track.longitudes[0] == 7.43864
    assert alpha_track.eastings[0] == pytest.approx(2_600_000, abs=5)
    assert alpha_track.northings[0] == pytest.approx(1_200_000, abs=5)


def test_has_no_border_unless_asked(extract: OsmExtract) -> None:
    assert extract.country is None
