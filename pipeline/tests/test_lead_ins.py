import math

import pytest
from test_network import line, place

from smb_pipeline.lead_ins import LEAD_IN_LENGTH_M, LeadInBuilder, starts_new_run
from smb_pipeline.network import NetworkGraph, build_network

WEST = 2_600_000.0
NORTH = 1_200_000.0


def main_line_with_a_branch() -> NetworkGraph:
    """Straight track west-east every 200 m, with a 27-degree branch leaving at x = 400 m."""
    main = line([(WEST + x, NORTH) for x in (0, 200, 400, 600, 800)], [1, 2, 3, 4, 5])
    branch = line([(WEST + 400, NORTH), (WEST + 200, NORTH + 100)], [3, 6])
    return build_network([main, branch])


def node_at(graph: NetworkGraph, x: float, y: float = 0.0) -> int:
    _, index = graph.node_locator.query((WEST + x, NORTH + y))
    return int(index)


def test_walks_the_straightest_track_behind_a_station() -> None:
    graph = main_line_with_a_branch()
    track = graph.track_behind(node_at(graph, 600), node_at(graph, 800), length_m=500)
    assert [graph.place_of(node).easting_m - WEST for node in track] == [400, 200, 0]


def test_lead_in_reaches_the_full_length_behind_the_start_in_travel_order() -> None:
    graph = main_line_with_a_branch()
    start, ahead = node_at(graph, 600), node_at(graph, 800)
    lead_in = LeadInBuilder(graph).lead_in(
        [graph.place_of(start), graph.place_of(ahead)], [start, ahead]
    )
    assert math.dist(lead_in[0].lv95, graph.place_of(start).lv95) >= LEAD_IN_LENGTH_M
    assert lead_in[-1].easting_m - WEST == pytest.approx(400)


def test_past_a_buffer_stop_the_lead_in_runs_straight_on() -> None:
    graph = main_line_with_a_branch()
    start, ahead = node_at(graph, 200), node_at(graph, 400)
    lead_in = LeadInBuilder(graph).lead_in(
        [graph.place_of(start), graph.place_of(ahead)], [start, ahead]
    )
    assert lead_in[0].easting_m - WEST == pytest.approx(200 - LEAD_IN_LENGTH_M)
    assert lead_in[0].northing_m == pytest.approx(NORTH)


def test_a_run_ends_where_the_train_reverses_or_the_path_breaks() -> None:
    eastbound = [place(WEST + x, NORTH) for x in (0, 100, 200)]
    onwards = [place(WEST + x, NORTH) for x in (200, 300, 400)]
    back = list(reversed(eastbound))
    far_away = [place(WEST + 5_000, NORTH), place(WEST + 5_100, NORTH)]
    assert not starts_new_run(eastbound, onwards)
    assert starts_new_run(eastbound, back)
    assert starts_new_run(eastbound, far_away)
    assert starts_new_run([], onwards)
