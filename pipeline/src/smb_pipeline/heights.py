"""How high every path runs: a height per point, so vehicles climb, cross bridges and dive.

The terrain model is a surface model (it includes buildings and forest), smoothed at 90 m, so
track can't simply follow it. Per path:

1. sample the surface every `SAMPLE_SPACING_M` along it;
2. smooth it along the path, more for main lines than for funiculars;
3. across OSM bridges and tunnels, run straight from one end to the other;
4. fill dips steeper than the line could climb (an embankment);
5. outside tunnels, never sink below the drawn ground, so a vehicle on the 3D map is seen.

Boats float at the lake's level. For cable cars the height is the rope's: from the stations
over the tops of OSM's pylons, sagging between them and never so low a cabin would touch ground.
"""

import itertools
import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np

from smb_pipeline.contract import MovingLayer, Ropeway, RouteKind
from smb_pipeline.dem import HeightModel
from smb_pipeline.geo import FloatArray, Place, simplify_indices, wgs84_from_lv95_arrays
from smb_pipeline.network import NetworkGraph, Structure
from smb_pipeline.routing import RoutedPath

# Closer than the 90 m terrain cells, so a valley crossed by a straight track isn't missed.
SAMPLE_SPACING_M: Final = 25.0
# A kept point may leave the profile this far off; the drawn height is accurate to it.
VERTICAL_TOLERANCE_M: Final = 0.5
# Track sits a little above the drawn ground, so it isn't half-buried where they agree.
CLEARANCE_M: Final = 0.3
# Where a rope leaves a station building.
STATION_ROPE_HEIGHT_M: Final = 12.0
# A rope sags about 3 % of a span between two supports, and on long spans at most this much.
ROPE_SAG_PER_SPAN: Final = 0.03
MAX_ROPE_SAG_M: Final = 40.0
# A cabin hangs about 9 m below its rope, so a rope this high keeps its floor 3 m off the
# ground anywhere: as high as at a station, where the cabin floats just above the platform.
MIN_ROPE_CLEARANCE_M: Final = STATION_ROPE_HEIGHT_M
MIN_SAMPLES_TO_SMOOTH: Final = 3

SMOOTHING_WINDOW_M: Final[dict[MovingLayer, float]] = {
    "long_rail": 200.0,
    "regional_rail": 200.0,
    "mountain_rail": 100.0,
    "funicular": 40.0,
    "boat": 0.0,
    "aerial": 0.0,
}
# Steepest climb a line can make: adhesion railways (the steepest Swiss ones reach ~7 %),
# rack railways (~25 %); funiculars follow the slope.
MAX_GRADE: Final[dict[MovingLayer, float | None]] = {
    "long_rail": 0.07,
    "regional_rail": 0.07,
    "mountain_rail": 0.25,
    "funicular": None,
    "boat": None,
    "aerial": None,
}


@dataclass(frozen=True, slots=True)
class PylonSpot:
    place: Place
    base_m: float
    top_m: float


@dataclass(frozen=True, slots=True)
class Profile:
    """A path reduced to the points that describe both its shape and its height."""

    places: list[Place]
    heights_m: list[float]
    ropeway: Ropeway | None = None
    pylons: tuple[PylonSpot, ...] = ()


@dataclass(frozen=True, slots=True)
class _Samples:
    places: list[Place]
    along_m: FloatArray
    """Distance from the first sample, per sample."""
    structures: list[Structure | None]
    """Per stretch between sample i and i + 1."""
    corners: list[int]
    """Sample index of each place the samples were made from."""


class HeightProfiler:
    """Gives paths and lead-ins their heights over the terrain."""

    def __init__(self, terrain: HeightModel, graphs: Mapping[RouteKind, NetworkGraph]) -> None:
        """`graphs`: the network each kind of routed path was found on (track, rope)."""
        self._terrain = terrain
        self._graphs = graphs

    def profile(self, path: RoutedPath, layer: MovingLayer, tolerance_m: float) -> Profile:
        """`path` with heights, simplified to `tolerance_m` across and `VERTICAL_TOLERANCE_M` up."""
        graph = self._graphs.get(path.route)
        if layer == "aerial":
            return self._rope(path, graph, tolerance_m)
        structures: list[Structure | None] = (
            [graph.structure_between(a, b) for a, b in itertools.pairwise(path.nodes)]
            if graph is not None and path.route == "track"
            else [None] * (len(path.points) - 1)
        )
        return self._profile(path.points, structures, layer, tolerance_m)

    def profile_places(
        self, places: Sequence[Place], layer: MovingLayer, tolerance_m: float
    ) -> Profile:
        """A lead-in or other path known only by its places (no bridges or tunnels marked)."""
        if layer == "aerial" and places:
            # Behind a ropeway station the rope stays at the station's height.
            surface = self._surface(places)
            return Profile(list(places), [float(h) + STATION_ROPE_HEIGHT_M for h in surface])
        return self._profile(places, [None] * max(0, len(places) - 1), layer, tolerance_m)

    def _rope(self, path: RoutedPath, graph: NetworkGraph | None, tolerance_m: float) -> Profile:
        """The rope's height along a ropeway: over its pylons' tops, sagging in between."""
        rope_graph = graph if path.route == "rope" else None
        supports = (
            [rope_graph.support_at(node) for node in path.nodes]
            if rope_graph is not None
            else [0.0] * len(path.points)
        )
        supports[0] = supports[0] or STATION_ROPE_HEIGHT_M
        supports[-1] = supports[-1] or STATION_ROPE_HEIGHT_M
        samples = _densify(path.points, [None] * (len(path.points) - 1))
        surface = self._surface(samples.places)
        corners = list(zip(samples.corners, supports, strict=True))
        held = [corner for corner, support in corners if support > 0]
        tops = {
            corner: float(surface[corner]) + support for corner, support in corners if support > 0
        }
        rope = np.maximum(rope_heights(samples.along_m, held, tops), surface + MIN_ROPE_CLEARANCE_M)
        kept = simplify_indices(
            [place.easting_m for place in samples.places],
            [place.northing_m for place in samples.places],
            tolerance_m,
            heights=list(rope),
            vertical_tolerance_m=VERTICAL_TOLERANCE_M,
        )
        ropeways = Counter(
            ropeway
            for a, b in itertools.pairwise(path.nodes)
            if rope_graph is not None and (ropeway := rope_graph.ropeway_between(a, b)) is not None
        )
        return Profile(
            [samples.places[i] for i in kept],
            [float(rope[i]) for i in kept],
            ropeway=ropeways.most_common(1)[0][0] if ropeways else None,
            pylons=tuple(
                PylonSpot(samples.places[corner], float(surface[corner]), tops[corner])
                for corner in held[1:-1]
            ),
        )

    def _profile(
        self,
        places: Sequence[Place],
        structures: Sequence[Structure | None],
        layer: MovingLayer,
        tolerance_m: float,
    ) -> Profile:
        if not places:
            return Profile([], [])
        samples = _densify(places, structures)
        surface = self._surface(samples.places)
        heights = self._heights(samples, surface, layer)
        kept = simplify_indices(
            [place.easting_m for place in samples.places],
            [place.northing_m for place in samples.places],
            tolerance_m,
            heights=list(heights),
            vertical_tolerance_m=VERTICAL_TOLERANCE_M,
        )
        return Profile([samples.places[i] for i in kept], [float(heights[i]) for i in kept])

    def _surface(self, places: Sequence[Place]) -> FloatArray:
        latitudes = np.array([place.latitude for place in places])
        longitudes = np.array([place.longitude for place in places])
        return self._terrain.heights(latitudes, longitudes)

    @staticmethod
    def _heights(samples: _Samples, surface: FloatArray, layer: MovingLayer) -> FloatArray:
        if layer == "boat":
            # Over a lake the surface model is the water itself; its lowest point is the level.
            return np.full(surface.shape, float(surface.min()))
        on_structure = _inside(samples.structures, "tunnel") | _inside(samples.structures, "bridge")
        heights = smoothed(surface, samples.along_m, SMOOTHING_WINDOW_M[layer], on_structure)
        heights = across_structures(heights, samples.along_m, samples.structures)
        grade = MAX_GRADE[layer]
        if grade is not None:
            heights = fill_dips(heights, samples.along_m, grade)
        underground = _inside(samples.structures, "tunnel")
        return np.where(underground, heights, np.maximum(heights, surface + CLEARANCE_M))


def rope_heights(along_m: FloatArray, held: Sequence[int], tops: Mapping[int, float]) -> FloatArray:
    """A rope hanging between supports at sample indices `held`, sagging in every span."""
    rope = np.zeros_like(along_m)
    for first, last in itertools.pairwise(held):
        span_m = along_m[last] - along_m[first]
        sag_m = min(MAX_ROPE_SAG_M, span_m * ROPE_SAG_PER_SPAN)
        share = (along_m[first : last + 1] - along_m[first]) / span_m if span_m > 0 else 0.0
        straight = tops[first] + share * (tops[last] - tops[first])
        rope[first : last + 1] = straight - 4 * sag_m * share * (1 - share)
    return rope


def smoothed(
    heights: FloatArray, along_m: FloatArray, window_m: float, ignored: np.ndarray | None = None
) -> FloatArray:
    """Mean height within `window_m` around each sample (centred, distance-based).

    Samples marked `ignored` (the ground under a bridge or over a tunnel) don't count; where a
    window holds nothing else, the sample keeps its own height.
    """
    if window_m <= 0 or len(heights) < MIN_SAMPLES_TO_SMOOTH:
        return heights.copy()
    weights = np.ones_like(heights) if ignored is None else (~ignored).astype(np.float64)
    weighted_sums = np.concatenate([[0.0], np.cumsum(heights * weights)])
    weight_sums = np.concatenate([[0.0], np.cumsum(weights)])
    starts = np.searchsorted(along_m, along_m - window_m / 2, side="left")
    ends = np.searchsorted(along_m, along_m + window_m / 2, side="right")
    counted = weight_sums[ends] - weight_sums[starts]
    totals = weighted_sums[ends] - weighted_sums[starts]
    means: FloatArray = np.where(counted > 0, totals / np.maximum(counted, 1e-9), heights)
    return means


def across_structures(
    heights: FloatArray, along_m: FloatArray, structures: Sequence[Structure | None]
) -> FloatArray:
    """Heights running straight across every bridge and tunnel, from one end to the other."""
    result = heights.copy()
    index = 0
    while index < len(structures):
        if structures[index] is None:
            index += 1
            continue
        first = index
        while index < len(structures) and structures[index] is not None:
            index += 1
        last = index  # the sample where the structure ends
        span = along_m[last] - along_m[first]
        if span > 0:
            share = (along_m[first : last + 1] - along_m[first]) / span
            result[first : last + 1] = heights[first] + share * (heights[last] - heights[first])
    return result


def fill_dips(heights: FloatArray, along_m: FloatArray, max_grade: float) -> FloatArray:
    """Raises dips the line couldn't climb out of, as an embankment would."""
    result = heights.copy()
    for i in range(1, len(result)):
        result[i] = max(result[i], result[i - 1] - max_grade * (along_m[i] - along_m[i - 1]))
    for i in range(len(result) - 2, -1, -1):
        result[i] = max(result[i], result[i + 1] - max_grade * (along_m[i + 1] - along_m[i]))
    return result


def _inside(structures: Sequence[Structure | None], kind: Structure) -> np.ndarray:
    """Per sample: whether it lies within (not just at the end of) a structure of `kind`."""
    count = len(structures) + 1
    inside = np.zeros(count, dtype=bool)
    for i in range(1, count - 1):
        inside[i] = structures[i - 1] == kind and structures[i] == kind
    return inside


def _densify(places: Sequence[Place], structures: Sequence[Structure | None]) -> _Samples:
    """Samples no further apart than `SAMPLE_SPACING_M`, keeping every original place."""
    eastings: list[float] = [places[0].easting_m]
    northings: list[float] = [places[0].northing_m]
    kept_places: list[Place | None] = [places[0]]
    sample_structures: list[Structure | None] = []
    corners = [0]
    for (start, end), structure in zip(itertools.pairwise(places), structures, strict=True):
        pieces = max(1, math.ceil(math.dist(start.lv95, end.lv95) / SAMPLE_SPACING_M))
        for piece in range(1, pieces + 1):
            share = piece / pieces
            eastings.append(start.easting_m + share * (end.easting_m - start.easting_m))
            northings.append(start.northing_m + share * (end.northing_m - start.northing_m))
            kept_places.append(end if piece == pieces else None)
            sample_structures.append(structure)
        corners.append(len(kept_places) - 1)
    latitudes, longitudes = wgs84_from_lv95_arrays(np.array(eastings), np.array(northings))
    samples = [
        place
        if place is not None
        else Place(eastings[i], northings[i], float(longitudes[i]), float(latitudes[i]))
        for i, place in enumerate(kept_places)
    ]
    steps = np.hypot(np.diff(eastings), np.diff(northings))
    along = np.concatenate([[0.0], np.cumsum(steps)])
    return _Samples(samples, along, sample_structures, corners)
