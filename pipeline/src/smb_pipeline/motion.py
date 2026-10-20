"""How every moving vehicle travels on one day: timetable legs placed on OSM paths."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from itertools import groupby
from typing import Final, get_args

import duckdb

from smb_pipeline.contract import (
    MINUTES_PER_DAY,
    Legs,
    Motion,
    MovingLayer,
    Segment,
    Trips,
    Tunnel,
    TunnelPassage,
)
from smb_pipeline.geo import Place, flat_lonlat, simplify_indices
from smb_pipeline.network import Tunnel as NetworkTunnel
from smb_pipeline.routing import RoutedPath, StopPair, straight_path

MOVING_LAYERS: Final[tuple[MovingLayer, ...]] = get_args(MovingLayer)
SECONDS_PER_MINUTE: Final = 60
# Precise geometry only drops points that lie within 1 m of the line through their
# neighbours (straight track drawn with many nodes): invisible even at street level.
PRECISE_TOLERANCE_M: Final = 1.0
# The country-wide view shows Switzerland at ~90 m per pixel; 15 m is far below that.
OVERVIEW_TOLERANCE_M: Final = 15.0


@dataclass(frozen=True, slots=True)
class LegRow:
    """One hop of one trip, straight from the timetable."""

    trip_id: str
    layer: MovingLayer
    origin: str
    destination: str
    depart_minute: int
    arrive_minute: int


Router = Callable[[Sequence[StopPair]], dict[StopPair, RoutedPath]]
"""Routes stop pairs for one layer (rail, ferry, or straight lines for cable cars)."""


def leg_rows(connection: duckdb.DuckDBPyConnection) -> list[LegRow]:
    """Every consecutive stop pair of every moving trip, ordered by trip and stop."""
    rows = connection.execute(
        """
        WITH ordered AS (
            SELECT st.trip_id, t.layer, sp.parent_id AS origin, st.seq, st.dep,
                   lead(sp.parent_id) OVER trip AS destination,
                   lead(st.arr) OVER trip AS arrival
              FROM day_stop_times st
              JOIN day_trips t ON t.trip_id = st.template_id
              JOIN stop_parent sp USING (stop_id)
             WHERE t.layer IN $layers
            WINDOW trip AS (PARTITION BY st.trip_id ORDER BY st.seq)
        )
        SELECT trip_id, layer, origin, destination, dep // 60, arrival // 60
          FROM ordered
         WHERE destination IS NOT NULL
           AND origin <> destination
           AND origin IN (SELECT parent_id FROM parents)
           AND destination IN (SELECT parent_id FROM parents)
         ORDER BY trip_id, seq
        """,
        {"layers": list(MOVING_LAYERS)},
    ).fetchall()
    return [LegRow(*row) for row in rows]


def station_positions(connection: duckdb.DuckDBPyConnection) -> dict[str, Place]:
    rows = connection.execute(
        "SELECT parent_id, easting_m, northing_m, lon, lat FROM parents"
    ).fetchall()
    return {
        parent_id: Place(easting, northing, longitude, latitude)
        for parent_id, easting, northing, longitude, latitude in rows
    }


SegmentKey = tuple[str, str, MovingLayer]
"""(first station, second station, layer) with the stations in sorted order."""


def build_motion(
    service_date: str,
    legs: Sequence[LegRow],
    paths: Mapping[SegmentKey, RoutedPath],
    tunnels: Sequence[NetworkTunnel],
) -> Motion:
    """Lays every trip's legs onto the routed paths (from `route_unique_pairs`)."""
    segment_index = {pair_key: index for index, pair_key in enumerate(paths)}

    trip_layers: list[MovingLayer] = []
    first_legs: list[int] = []
    leg_counts: list[int] = []
    segment_column: list[int] = []
    reversed_column: list[bool] = []
    depart_column: list[int] = []
    arrive_column: list[int] = []
    for _, trip_legs_iter in groupby(legs, key=lambda leg: leg.trip_id):
        # Legs with a station outside the map have no path; the vehicle leaves the map there.
        trip_legs = [leg for leg in trip_legs_iter if segment_key(leg)[0] in segment_index]
        if not trip_legs:
            continue
        shift = _midnight_shift(trip_legs[0].depart_minute)
        trip_layers.append(trip_legs[0].layer)
        first_legs.append(len(segment_column))
        leg_counts.append(len(trip_legs))
        for leg in trip_legs:
            key, is_reversed = segment_key(leg)
            segment_column.append(segment_index[key])
            reversed_column.append(is_reversed)
            depart_column.append(leg.depart_minute - shift)
            arrive_column.append(max(leg.arrive_minute, leg.depart_minute) - shift)

    return Motion(
        service_date=service_date,
        segments=[_segment(path) for path in paths.values()],
        trips=Trips(layer=trip_layers, first_leg=first_legs, leg_count=leg_counts),
        legs=Legs(
            segment=segment_column,
            reversed=reversed_column,
            depart_minute=depart_column,
            arrive_minute=arrive_column,
        ),
        tunnels=[_contract_tunnel(tunnel) for tunnel in tunnels],
    )


def tunnel_occupancy(motion: Motion) -> list[list[int]]:
    """For each tunnel, how many vehicles are inside it during each minute of the day."""
    occupancy = [[0] * MINUTES_PER_DAY for _ in motion.tunnels]
    legs = motion.legs
    for leg in range(len(legs.segment)):
        segment = motion.segments[legs.segment[leg]]
        duration = legs.arrive_minute[leg] - legs.depart_minute[leg]
        for passage in segment.tunnels:
            start, end = passage.start_fraction, passage.end_fraction
            if legs.reversed[leg]:
                start, end = 1 - end, 1 - start
            enter = legs.depart_minute[leg] + start * duration
            leave = legs.depart_minute[leg] + end * duration
            for minute in range(int(enter), max(int(enter) + 1, int(leave))):
                occupancy[passage.tunnel][minute % MINUTES_PER_DAY] += 1
    return occupancy


def route_unique_pairs(
    legs: Sequence[LegRow], routers: Mapping[MovingLayer, Router]
) -> dict[SegmentKey, RoutedPath]:
    """One path per unordered stop pair and layer, routed in a canonical direction."""
    pairs_by_layer: dict[MovingLayer, set[StopPair]] = {layer: set() for layer in MOVING_LAYERS}
    for leg in legs:
        (origin, destination, layer), _ = segment_key(leg)
        pairs_by_layer[layer].add(StopPair(origin, destination))
    paths: dict[SegmentKey, RoutedPath] = {}
    for layer, pairs in pairs_by_layer.items():
        if not pairs:
            continue
        for pair, path in routers[layer](sorted(pairs, key=_pair_order)).items():
            paths[(pair.origin, pair.destination, layer)] = path
    return paths


def segment_key(leg: LegRow) -> tuple[SegmentKey, bool]:
    """Key of the shared segment for a leg, and whether the leg runs it backwards."""
    if leg.origin <= leg.destination:
        return (leg.origin, leg.destination, leg.layer), False
    return (leg.destination, leg.origin, leg.layer), True


def _pair_order(pair: StopPair) -> tuple[str, str]:
    return pair.origin, pair.destination


def _midnight_shift(first_departure_minute: int) -> int:
    """Trips starting after 24:00 belong to the small hours: play them at the day's start."""
    return MINUTES_PER_DAY if first_departure_minute >= MINUTES_PER_DAY else 0


def _segment(path: RoutedPath) -> Segment:
    length = max(path.length_m, 1.0)
    return Segment(
        coordinates=flat_lonlat(simplified(path.points, PRECISE_TOLERANCE_M)),
        overview_coordinates=flat_lonlat(simplified(path.points, OVERVIEW_TOLERANCE_M)),
        length_m=round(path.length_m),
        route=path.route,
        tunnels=[
            TunnelPassage(
                tunnel=span.tunnel,
                start_fraction=round(span.start_m / length, 4),
                end_fraction=round(span.end_m / length, 4),
            )
            for span in path.tunnel_spans
        ],
    )


def simplified(places: Sequence[Place], tolerance_m: float) -> list[Place]:
    """The places Douglas-Peucker keeps at this tolerance (measured in metres)."""
    kept = simplify_indices(
        [place.easting_m for place in places], [place.northing_m for place in places], tolerance_m
    )
    return [places[index] for index in kept]


def _contract_tunnel(tunnel: NetworkTunnel) -> Tunnel:
    return Tunnel(
        id=tunnel.id,
        name=tunnel.name,
        length_m=round(tunnel.length_m),
        coordinates=flat_lonlat([tunnel.axis_start, tunnel.axis_end]),
    )


def straight_router(positions: Mapping[str, Place]) -> Router:
    """Cable cars travel in straight lines between their stations."""

    def route(pairs: Sequence[StopPair]) -> dict[StopPair, RoutedPath]:
        return {
            pair: straight_path(positions[pair.origin], positions[pair.destination])
            for pair in pairs
        }

    return route
