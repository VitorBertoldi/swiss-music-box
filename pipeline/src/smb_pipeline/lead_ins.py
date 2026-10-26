"""Where a train stands before it moves: the track behind the start of each run.

The timetable places a train at a station only as a point. Drawn with its real length, a
departing train needs track behind that point for its rear cars; without it the train would
grow out of the station car by car. A trip's legs are joined into runs; a new run starts at
the trip's first station, wherever the train reverses (a terminus), and after a gap in the map.
"""

import itertools
import math
from collections.abc import Sequence
from typing import Final

import numpy as np

from smb_pipeline.geo import Place, wgs84_from_lv95_arrays
from smb_pipeline.network import NetworkGraph

# Longer than the longest train drawn (an IC, about 400 m).
LEAD_IN_LENGTH_M: Final = 500.0
# Two legs that meet at this angle or sharper mean the train changes direction.
REVERSAL_ANGLE_DEG: Final = 120.0
# Each stop pair is routed on its own, so two legs can meet a station on different platform
# tracks (snapped within 300 m of it). Further apart than this, legs don't meet (a leg was
# dropped outside the map) and a new run starts.
JOINT_GAP_M: Final = 1_000.0
# Headings are measured over this much path, so a kink at a switch doesn't count as a turn.
HEADING_PROBE_M: Final = 50.0
POINTS_FOR_A_DIRECTION: Final = 2


def starts_new_run(previous: Sequence[Place], following: Sequence[Place]) -> bool:
    """Whether the leg `following` can't continue the run that `previous` ended (travel order)."""
    if not previous or not following:
        return True
    if math.dist(previous[-1].lv95, following[0].lv95) > JOINT_GAP_M:
        return True
    arriving = _heading(list(reversed(previous)), reverse=True)
    leaving = _heading(list(following), reverse=False)
    if arriving is None or leaving is None:
        return False
    alignment = arriving[0] * leaving[0] + arriving[1] * leaving[1]
    return alignment < math.cos(math.radians(REVERSAL_ANGLE_DEG))


class LeadInBuilder:
    """Finds the lead-in of a run: OSM track behind its start, then a straight extension."""

    def __init__(self, rail_graph: NetworkGraph, length_m: float = LEAD_IN_LENGTH_M) -> None:
        self._rail = rail_graph
        self._length_m = length_m

    def lead_in(self, points: Sequence[Place], nodes: Sequence[int]) -> list[Place]:
        """The places behind `points[0]`, in travel order, ending just before it.

        `points` is the run's first leg in travel order; `nodes` its rail graph nodes in the
        same order (empty when the leg isn't on the rail graph).
        """
        behind: list[Place] = []
        if len(nodes) >= POINTS_FOR_A_DIRECTION:
            track = self._rail.track_behind(nodes[0], nodes[1], self._length_m)
            behind = [self._rail.place_of(node) for node in track]
        start = points[0]
        walked_m = _length([start, *behind])
        if walked_m < self._length_m:
            behind.extend(self._straight_on([start, *behind], points, self._length_m - walked_m))
        return list(reversed(behind))

    @staticmethod
    def _straight_on(
        behind: Sequence[Place], points: Sequence[Place], extra_m: float
    ) -> list[Place]:
        """Continues the line behind the run's start straight on, for `extra_m` metres."""
        if len(behind) >= POINTS_FOR_A_DIRECTION:
            direction = _heading(list(reversed(behind)), reverse=True)
        else:
            ahead = _heading(list(points), reverse=False)
            direction = None if ahead is None else (-ahead[0], -ahead[1])
        if direction is None:
            return []
        end = behind[-1]
        easting = end.easting_m + direction[0] * extra_m
        northing = end.northing_m + direction[1] * extra_m
        latitudes, longitudes = wgs84_from_lv95_arrays(np.array([easting]), np.array([northing]))
        return [Place(easting, northing, float(longitudes[0]), float(latitudes[0]))]


def _heading(points: Sequence[Place], *, reverse: bool) -> tuple[float, float] | None:
    """Unit direction from the first point to the point `HEADING_PROBE_M` along the path.

    With `reverse`, the direction is flipped: for a path given end-first, the travel heading.
    """
    if len(points) < POINTS_FOR_A_DIRECTION:
        return None
    origin = points[0]
    target = points[-1]
    walked_m = 0.0
    for previous, point in itertools.pairwise(points):
        walked_m += math.dist(previous.lv95, point.lv95)
        target = point
        if walked_m >= HEADING_PROBE_M:
            break
    east = target.easting_m - origin.easting_m
    north = target.northing_m - origin.northing_m
    length = math.hypot(east, north)
    if length == 0:
        return None
    sign = -1.0 if reverse else 1.0
    return sign * east / length, sign * north / length


def _length(points: Sequence[Place]) -> float:
    return sum(math.dist(a.lv95, b.lv95) for a, b in itertools.pairwise(points))
