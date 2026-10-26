"""Transport networks built from OSM ways: a weighted graph plus the long tunnels on it."""

import itertools
import math
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final, Literal

import numpy as np
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

from smb_pipeline.geo import FloatArray, Place, Point
from smb_pipeline.osm import OsmLine

# A train can't turn sharper than this between two pieces of track; a walk along the track
# follows the straightest branch at a switch and stops where only sharper turns remain.
MAX_TRACK_TURN_DEG: Final = 30.0
LONG_TUNNEL_MIN_LENGTH_M: Final = 3_000
Structure = Literal["tunnel", "bridge"]  # shorter tunnels pass in a blink at 8 min/s
TUBE_MERGE_DISTANCE_M: Final = 1_000


@dataclass(frozen=True, slots=True)
class Tunnel:
    """A long tunnel: every tube and track with the same name (or connected, if unnamed)."""

    id: str
    name: str
    length_m: float
    axis_start: Place
    axis_end: Place


@dataclass(frozen=True)
class NetworkGraph:
    """Undirected graph of OSM nodes; edge weights are lengths in metres."""

    node_eastings: FloatArray
    node_northings: FloatArray
    node_longitudes: FloatArray
    node_latitudes: FloatArray
    lengths: csr_matrix
    tunnels: Sequence[Tunnel]
    edge_tunnel: dict[tuple[int, int], int] = field(repr=False)
    """Tunnel index for edges inside a long tunnel, keyed by (smaller, larger) node index."""
    node_locator: cKDTree = field(repr=False)
    structure_edges: Mapping[tuple[int, int], Structure] = field(default_factory=dict, repr=False)
    """Edges on any bridge or in any tunnel: there the track doesn't follow the ground."""

    def structure_between(self, node_a: int, node_b: int) -> Structure | None:
        return self.structure_edges.get((min(node_a, node_b), max(node_a, node_b)))

    def tunnel_on_edge(self, node_a: int, node_b: int) -> int | None:
        return self.edge_tunnel.get((min(node_a, node_b), max(node_a, node_b)))

    def neighbours(self, node: int) -> list[int]:
        start, end = self.lengths.indptr[node], self.lengths.indptr[node + 1]
        return [int(neighbour) for neighbour in self.lengths.indices[start:end]]

    def track_behind(self, start: int, ahead: int, length_m: float) -> list[int]:
        """Nodes of the track continuing behind `start`, away from `ahead`, nearest first.

        Follows the straightest branch at every switch, for about `length_m`, and stops early
        at a dead end (a buffer stop) or where the track would turn too sharply.
        """
        min_alignment = math.cos(math.radians(MAX_TRACK_TURN_DEG))
        nodes: list[int] = []
        previous, current, walked_m = ahead, start, 0.0
        while walked_m < length_m:
            heading = self._direction(previous, current)
            best, best_alignment = None, min_alignment
            for neighbour in self.neighbours(current):
                if neighbour == previous:
                    continue
                direction = self._direction(current, neighbour)
                alignment = heading[0] * direction[0] + heading[1] * direction[1]
                if alignment > best_alignment:
                    best, best_alignment = neighbour, alignment
            if best is None:
                break
            walked_m += math.dist(self.place_of(current).lv95, self.place_of(best).lv95)
            nodes.append(best)
            previous, current = current, best
        return nodes

    def _direction(self, from_node: int, to_node: int) -> Point:
        east = float(self.node_eastings[to_node] - self.node_eastings[from_node])
        north = float(self.node_northings[to_node] - self.node_northings[from_node])
        length = math.hypot(east, north) or 1.0
        return east / length, north / length

    def place_of(self, node: int) -> Place:
        return Place(
            float(self.node_eastings[node]),
            float(self.node_northings[node]),
            float(self.node_longitudes[node]),
            float(self.node_latitudes[node]),
        )


class NetworkGraphBuilder:
    """Collects OSM lines, then builds an immutable `NetworkGraph`."""

    def __init__(self) -> None:
        self._node_index: dict[int, int] = {}
        self._eastings: list[float] = []
        self._northings: list[float] = []
        self._longitudes: list[float] = []
        self._latitudes: list[float] = []
        self._edge_lengths: dict[tuple[int, int], float] = {}
        """Length of each edge, keyed by (smaller, larger) node index, so duplicates collapse."""
        self._tunnel_edges: dict[tuple[int, int], int] = {}
        self._structure_edges: dict[tuple[int, int], Structure] = {}

    def add_line(self, line: OsmLine, tunnel_index: int | None = None) -> None:
        nodes = [
            self._index_of(osm_id, Place(easting, northing, longitude, latitude))
            for osm_id, easting, northing, longitude, latitude in zip(
                line.node_ids.tolist(),
                line.eastings.tolist(),
                line.northings.tolist(),
                line.longitudes.tolist(),
                line.latitudes.tolist(),
                strict=True,
            )
        ]
        for start, end in itertools.pairwise(nodes):
            if start == end:
                continue
            edge = (min(start, end), max(start, end))
            self._edge_lengths[edge] = math.dist(
                (self._eastings[start], self._northings[start]),
                (self._eastings[end], self._northings[end]),
            )
            if tunnel_index is not None:
                self._tunnel_edges[edge] = tunnel_index
            if line.is_tunnel:
                self._structure_edges[edge] = "tunnel"
            elif line.is_bridge:
                self._structure_edges[edge] = "bridge"

    def build(self, tunnels: Sequence[Tunnel]) -> NetworkGraph:
        node_count = len(self._eastings)
        starts = [start for start, _ in self._edge_lengths]
        ends = [end for _, end in self._edge_lengths]
        weights = list(self._edge_lengths.values())
        # Both directions, so the matrix is symmetric and routing works either way.
        lengths = csr_matrix(
            (weights * 2, (starts + ends, ends + starts)), shape=(node_count, node_count)
        )
        eastings = np.array(self._eastings)
        northings = np.array(self._northings)
        return NetworkGraph(
            node_eastings=eastings,
            node_northings=northings,
            node_longitudes=np.array(self._longitudes),
            node_latitudes=np.array(self._latitudes),
            lengths=lengths,
            tunnels=tunnels,
            edge_tunnel=self._tunnel_edges,
            structure_edges=self._structure_edges,
            node_locator=cKDTree(np.column_stack([eastings, northings])),
        )

    def _index_of(self, osm_node_id: int, place: Place) -> int:
        index = self._node_index.get(osm_node_id)
        if index is None:
            index = len(self._eastings)
            self._node_index[osm_node_id] = index
            self._eastings.append(place.easting_m)
            self._northings.append(place.northing_m)
            self._longitudes.append(place.longitude)
            self._latitudes.append(place.latitude)
        return index


def build_network(
    lines: Iterable[OsmLine], name_near: Callable[[float, float], str] | None = None
) -> NetworkGraph:
    """A graph of the given lines; with `name_near`, long tunnels are identified and named."""
    line_list = list(lines)
    tunnels, tunnel_of_line = (
        find_long_tunnels(line_list, name_near) if name_near is not None else ([], {})
    )
    builder = NetworkGraphBuilder()
    for line in line_list:
        builder.add_line(line, tunnel_of_line.get(line.osm_id))
    return builder.build(tunnels)


@dataclass(frozen=True)
class _TunnelPiece:
    """Connected tunnel ways (one tube, or several tubes joined by crossovers)."""

    name: str
    ways: list[OsmLine]

    @property
    def endpoints(self) -> list[Place]:
        return [
            Place(
                float(way.eastings[index]),
                float(way.northings[index]),
                float(way.longitudes[index]),
                float(way.latitudes[index]),
            )
            for way in self.ways
            for index in (0, -1)
        ]


def find_long_tunnels(
    lines: Sequence[OsmLine], name_near: Callable[[float, float], str]
) -> tuple[list[Tunnel], dict[int, int]]:
    """Tunnels at least `LONG_TUNNEL_MIN_LENGTH_M` long, and the tunnel index of each way.

    OSM maps each tube and track as separate ways. Ways that share nodes form a piece; pieces
    with the same name (OSM's, or "Tunnel near <station>" when it has none) are one tunnel
    when they lie side by side. Length is the distance between the farthest endpoints, which
    suits tunnels because they are close to straight.
    """
    pieces = [
        _TunnelPiece(_piece_name(component, name_near), component)
        for component in _connected_components([line for line in lines if line.is_tunnel])
    ]
    tunnels: list[Tunnel] = []
    tunnel_of_line: dict[int, int] = {}
    for group in _merge_side_by_side_namesakes(pieces):
        start, end = _farthest_pair([point for piece in group for point in piece.endpoints])
        length_m = math.dist(start.lv95, end.lv95)
        if length_m < LONG_TUNNEL_MIN_LENGTH_M:
            continue
        name = group[0].name
        tunnels.append(Tunnel(_unique_id(name, tunnels), name, length_m, start, end))
        tunnel_of_line.update(
            {way.osm_id: len(tunnels) - 1 for piece in group for way in piece.ways}
        )
    return tunnels, tunnel_of_line


def _piece_name(ways: Sequence[OsmLine], name_near: Callable[[float, float], str]) -> str:
    names = Counter(way.name for way in ways if way.name)
    if names:
        return names.most_common(1)[0][0]
    start, end = _farthest_pair(_TunnelPiece("", list(ways)).endpoints)
    return f"Tunnel near {name_near(*_midpoint(start, end))}"


def _merge_side_by_side_namesakes(pieces: Sequence[_TunnelPiece]) -> list[list[_TunnelPiece]]:
    """Groups pieces with the same name lying within `TUBE_MERGE_DISTANCE_M` of each other.

    Parallel tubes of one tunnel run tens of metres apart; different tunnels that happen to
    share a name ("Bühltunnel") are kilometres apart and stay separate.
    """
    groups: list[list[_TunnelPiece]] = []
    for piece in pieces:
        neighbour_group = next(
            (
                group
                for group in groups
                if group[0].name == piece.name
                and _closest_distance(group, piece) <= TUBE_MERGE_DISTANCE_M
            ),
            None,
        )
        if neighbour_group is None:
            groups.append([piece])
        else:
            neighbour_group.append(piece)
    return groups


def _closest_distance(group: Sequence[_TunnelPiece], piece: _TunnelPiece) -> float:
    return min(
        math.dist(a.lv95, b.lv95)
        for member in group
        for a in member.endpoints
        for b in piece.endpoints
    )


def _connected_components(lines: Sequence[OsmLine]) -> list[list[OsmLine]]:
    """Lines grouped so that lines sharing an OSM node are in the same group (union-find)."""
    parent = list(range(len(lines)))

    def root(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    first_line_at_node: dict[int, int] = {}
    for line_index, line in enumerate(lines):
        for node_id in line.node_ids.tolist():
            other = first_line_at_node.setdefault(node_id, line_index)
            parent[root(other)] = root(line_index)
    components: dict[int, list[OsmLine]] = defaultdict(list)
    for line_index, line in enumerate(lines):
        components[root(line_index)].append(line)
    return list(components.values())


def _farthest_pair(places: Sequence[Place]) -> tuple[Place, Place]:
    return max(
        itertools.combinations(places, 2), key=lambda pair: math.dist(pair[0].lv95, pair[1].lv95)
    )


def _midpoint(a: Place, b: Place) -> Point:
    return (a.easting_m + b.easting_m) / 2, (a.northing_m + b.northing_m) / 2


def _unique_id(name: str, existing: Sequence[Tunnel]) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-") or "tunnel"
    taken = {tunnel.id for tunnel in existing}
    candidate, suffix = slug, 2
    while candidate in taken:
        candidate, suffix = f"{slug}-{suffix}", suffix + 1
    return candidate
