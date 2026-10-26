"""Finding the path a vehicle takes between two consecutive stops.

GTFS only says "Bern 08:02 -> Thun 08:19"; the track in between comes from OSM. Each origin
station is routed once (one Dijkstra run reaches all its destinations), and stations are
snapped to several nearby graph nodes, so a station served by two gauges finds the right one.
"""

import itertools
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
from scipy.sparse.csgraph import dijkstra

from smb_pipeline.contract import RouteKind
from smb_pipeline.geo import Place
from smb_pipeline.network import NetworkGraph

NO_PREDECESSOR: Final = -9999  # scipy's marker for the start of a path
# Stations are mapped where passengers board; the OSM track can be a platform's width away,
# and large stations (Zürich HB underground) a few hundred metres.
DEFAULT_SNAP_RADIUS_M: Final = 300.0
SNAP_CANDIDATES: Final = 12
# A route much longer than the straight line means the snap picked the wrong line.
MAX_DETOUR_FACTOR: Final = 3.0
MIN_SEARCH_RADIUS_M: Final = 5_000.0
MIN_PATH_NODES: Final = 2
# A station this far from every track of the network lies outside the OSM extract
# (e.g. German stations on Lake Constance); its legs leave the map instead of being drawn.
OUTSIDE_EXTRACT_M: Final = 2_000.0


@dataclass(frozen=True, slots=True)
class StopPair:
    """Two stations, identified by GTFS parent id, in travel order."""

    origin: str
    destination: str


@dataclass(frozen=True, slots=True)
class TunnelSpan:
    tunnel: int
    start_m: float
    end_m: float


@dataclass(frozen=True, slots=True)
class RoutedPath:
    points: list[Place]
    length_m: float
    route: RouteKind
    tunnel_spans: list[TunnelSpan]
    nodes: tuple[int, ...] = ()
    """Graph nodes along the path, one per point; empty for straight lines."""

    @property
    def is_fallback(self) -> bool:
        return self.route == "straight"


def straight_path(origin: Place, destination: Place) -> RoutedPath:
    """Used for cable cars (which really are straight) and when routing finds nothing."""
    return RoutedPath(
        [origin, destination], math.dist(origin.lv95, destination.lv95), "straight", []
    )


class NetworkRouter:
    """Routes stop pairs over one `NetworkGraph`."""

    def __init__(
        self,
        graph: NetworkGraph,
        route_kind: RouteKind,
        snap_radius_m: float = DEFAULT_SNAP_RADIUS_M,
    ) -> None:
        self._graph = graph
        self._route_kind = route_kind
        self._snap_radius_m = snap_radius_m

    def route_all(
        self, pairs: Sequence[StopPair], positions: Mapping[str, Place]
    ) -> dict[StopPair, RoutedPath]:
        """A path for every pair inside the extract; unconnectable pairs get a straight line.

        Pairs with a station outside the extract are left out of the result.
        """
        destinations_by_origin: dict[str, list[str]] = defaultdict(list)
        for pair in pairs:
            if self.covers(positions[pair.origin]) and self.covers(positions[pair.destination]):
                destinations_by_origin[pair.origin].append(pair.destination)
        routes: dict[StopPair, RoutedPath] = {}
        for origin, destinations in destinations_by_origin.items():
            routes.update(self._route_from(origin, destinations, positions))
        return routes

    @property
    def graph(self) -> NetworkGraph:
        return self._graph

    def covers(self, place: Place) -> bool:
        """Whether the network reaches this place, i.e. it lies inside the OSM extract."""
        distance, _ = self._graph.node_locator.query(place.lv95)
        return bool(distance <= OUTSIDE_EXTRACT_M)

    def _route_from(
        self, origin: str, destinations: Sequence[str], positions: Mapping[str, Place]
    ) -> dict[StopPair, RoutedPath]:
        origin_place = positions[origin]
        origin_nodes = self._snap(origin_place)
        if not origin_nodes:
            return {
                StopPair(origin, destination): straight_path(origin_place, positions[destination])
                for destination in destinations
            }
        search_radius = max(
            MIN_SEARCH_RADIUS_M,
            max(
                MAX_DETOUR_FACTOR * math.dist(origin_place.lv95, positions[destination].lv95)
                for destination in destinations
            ),
        )
        distances, predecessors, _ = dijkstra(
            self._graph.lengths,
            directed=False,
            indices=origin_nodes,
            min_only=True,
            return_predecessors=True,
            limit=search_radius,
        )
        return {
            StopPair(origin, destination): self._path_to(
                destination, origin_place, positions, distances, predecessors
            )
            for destination in destinations
        }

    def _path_to(
        self,
        destination: str,
        origin_place: Place,
        positions: Mapping[str, Place],
        distances: np.ndarray,
        predecessors: np.ndarray,
    ) -> RoutedPath:
        destination_place = positions[destination]
        reachable = [node for node in self._snap(destination_place) if np.isfinite(distances[node])]
        if not reachable:
            return straight_path(origin_place, destination_place)
        end_node = min(reachable, key=lambda node: distances[node])
        straight_m = math.dist(origin_place.lv95, destination_place.lv95)
        if distances[end_node] > MAX_DETOUR_FACTOR * straight_m + 2 * self._snap_radius_m:
            return straight_path(origin_place, destination_place)
        nodes = _walk_back(end_node, predecessors)
        if len(nodes) < MIN_PATH_NODES:  # both stations snapped onto the same node
            return straight_path(origin_place, destination_place)
        return RoutedPath(
            points=[self._graph.place_of(node) for node in nodes],
            length_m=float(distances[end_node]),
            route=self._route_kind,
            tunnel_spans=self._tunnel_spans(nodes),
            nodes=tuple(nodes),
        )

    def _snap(self, place: Place) -> list[int]:
        distances, nodes = self._graph.node_locator.query(
            place.lv95, k=SNAP_CANDIDATES, distance_upper_bound=self._snap_radius_m
        )
        return [int(n) for d, n in zip(distances, nodes, strict=True) if np.isfinite(d)]

    def _tunnel_spans(self, nodes: Sequence[int]) -> list[TunnelSpan]:
        """Consecutive tunnel edges merged into spans, measured along the path."""
        spans: list[TunnelSpan] = []
        travelled_m = 0.0
        for start, end in itertools.pairwise(nodes):
            edge_m = math.dist(
                (self._graph.node_eastings[start], self._graph.node_northings[start]),
                (self._graph.node_eastings[end], self._graph.node_northings[end]),
            )
            tunnel = self._graph.tunnel_on_edge(start, end)
            if tunnel is not None:
                if spans and spans[-1].tunnel == tunnel and spans[-1].end_m == travelled_m:
                    spans[-1] = TunnelSpan(tunnel, spans[-1].start_m, travelled_m + edge_m)
                else:
                    spans.append(TunnelSpan(tunnel, travelled_m, travelled_m + edge_m))
            travelled_m += edge_m
        return spans


def _walk_back(end_node: int, predecessors: np.ndarray) -> list[int]:
    nodes = [end_node]
    while (previous := int(predecessors[nodes[-1]])) != NO_PREDECESSOR:
        nodes.append(previous)
    nodes.reverse()
    return nodes
