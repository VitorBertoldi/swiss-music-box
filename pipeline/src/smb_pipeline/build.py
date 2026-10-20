"""Facade: the few entry points the CLI calls, each producing one contract file."""

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Final

import duckdb

from smb_pipeline import events, feed, stations
from smb_pipeline.contract import (
    Bounds,
    Day,
    Motion,
    MovingLayer,
    RouteKind,
    Station,
)
from smb_pipeline.elevation import ElevationProvider
from smb_pipeline.geo import SWITZERLAND, WGS84_DECIMALS, Place
from smb_pipeline.motion import (
    LegRow,
    Router,
    SegmentKey,
    build_motion,
    leg_rows,
    route_unique_pairs,
    segment_key,
    station_positions,
    straight_router,
    tunnel_occupancy,
)
from smb_pipeline.network import build_network
from smb_pipeline.osm import NetworkKind, read_osm
from smb_pipeline.routing import NetworkRouter, RoutedPath, StopPair
from smb_pipeline.tunnels import drone_tunnels

DEFAULT_TEXTURE_BINS: Final = 8
RAIL_KINDS: Final[frozenset[NetworkKind]] = frozenset({"rail", "mountain_rail", "funicular"})
FERRY_KINDS: Final[frozenset[NetworkKind]] = frozenset({"ferry"})
# Piers sit at the shore while OSM ferry routes often start a little way out on the water.
FERRY_SNAP_RADIUS_M: Final = 800.0


@dataclass(frozen=True)
class RoutingReport:
    """Number of distinct stop pairs per layer and route kind ("straight" = not on OSM)."""

    pairs: Counter[tuple[MovingLayer, RouteKind]]
    outside_extract: Counter[MovingLayer]


@dataclass(frozen=True)
class DayBuild:
    day: Day
    motion: Motion
    routing: RoutingReport


def build_day(
    gtfs_dir: Path,
    osm_pbf: Path,
    service_date: date,
    elevation: ElevationProvider,
    bounds: Bounds = SWITZERLAND,
    texture_bins: int = DEFAULT_TEXTURE_BINS,
) -> DayBuild:
    """Everything that happens on one service day: the sound (`Day`) and the motion."""
    connection = duckdb.connect()
    try:
        feed.register_feed(connection, gtfs_dir)
        feed.materialize_service_day(connection, service_date)
        stations.materialize_parents(connection, bounds)
        events.materialize_departures(connection)

        motion, routing = _motion(connection, osm_pbf, service_date)
        station_rows = events.note_stations(connection)
        elevations_m = elevation.elevations([station.position for station in station_rows])
        day = Day(
            service_date=service_date.isoformat(),
            source=gtfs_dir.name,
            texture_bins=texture_bins,
            bounds=bounds,
            stations=[
                Station(
                    name=station.name,
                    easting_m=round(station.easting_m),
                    northing_m=round(station.northing_m),
                    longitude=round(station.position.lon, WGS84_DECIMALS),
                    latitude=round(station.position.lat, WGS84_DECIMALS),
                    elevation_m=elevation_m,
                )
                for station, elevation_m in zip(station_rows, elevations_m, strict=True)
            ],
            notes=events.note_events(connection, station_rows),
            textures=events.textures(connection, bounds, texture_bins),
            tunnels=drone_tunnels(motion, tunnel_occupancy(motion)),
        )
        return DayBuild(day=day, motion=motion, routing=routing)
    finally:
        connection.close()


def _motion(
    connection: duckdb.DuckDBPyConnection, osm_pbf: Path, service_date: date
) -> tuple[Motion, RoutingReport]:
    positions = station_positions(connection)
    locator = stations.StationLocator(connection)
    extract = read_osm(osm_pbf, kinds=RAIL_KINDS | FERRY_KINDS)
    rail_graph = build_network(
        (line for line in extract.lines if line.kind in RAIL_KINDS), locator.nearest_name
    )
    ferry_graph = build_network(line for line in extract.lines if line.kind == "ferry")
    rail = _bind(NetworkRouter(rail_graph, "track"), positions)
    ferry = _bind(NetworkRouter(ferry_graph, "ferry_route", FERRY_SNAP_RADIUS_M), positions)
    routers: dict[MovingLayer, Router] = {
        "long_rail": rail,
        "regional_rail": rail,
        "mountain_rail": rail,
        "funicular": rail,
        "boat": ferry,
        "aerial": straight_router(positions),
    }
    legs = leg_rows(connection)
    paths = route_unique_pairs(legs, routers)
    report = RoutingReport(
        pairs=Counter((layer, path.route) for (_, _, layer), path in paths.items()),
        outside_extract=_pairs_outside_extract(legs, paths),
    )
    motion = build_motion(service_date.isoformat(), legs, paths, rail_graph.tunnels)
    return motion, report


def _pairs_outside_extract(
    legs: Sequence[LegRow], paths: Mapping[SegmentKey, RoutedPath]
) -> Counter[MovingLayer]:
    requested = {segment_key(leg)[0] for leg in legs}
    return Counter(layer for key in requested - paths.keys() for layer in [key[2]])


def _bind(router: NetworkRouter, positions: Mapping[str, Place]) -> Router:
    """Adapts a network router to the `Router` signature used per layer."""

    def route(pairs: Sequence[StopPair]) -> dict[StopPair, RoutedPath]:
        return router.route_all(pairs, positions)

    return route
