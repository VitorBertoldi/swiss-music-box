"""Geographic helpers: WGS84 (GPS latitude/longitude), Swiss LV95 metres, Web Mercator.

Measuring is done in LV95 metres (flat and metric over Switzerland); drawing is done in
WGS84 degrees, which is what OSM stores and what map tiles use. A `Place` carries both, so
nothing ever has to convert back and lose precision.

The swisstopo approximate formulas are accurate to about 1 m inside Switzerland. Each
formula is written once, on numpy arrays; the scalar helpers wrap it.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
import numpy.typing as npt

from smb_pipeline.contract import Bounds

FloatArray = npt.NDArray[np.float64]
Point = tuple[float, float]
"""(easting, northing) in LV95 metres."""

# Bern's old observatory, the origin of the Swiss grid, in seconds of arc.
_ORIGIN_LATITUDE_ARCSEC = 169_028.66
_ORIGIN_LONGITUDE_ARCSEC = 26_782.5
_ARCSEC_PER_DEGREE = 3600
_AUXILIARY_SCALE = 10_000
_LV95_FALSE_EASTING_M = 2_600_000
_LV95_FALSE_NORTHING_M = 1_200_000

# 7 decimals of a degree are about 1 cm: finer than any OSM survey.
WGS84_DECIMALS: Final = 7
EARTH_RADIUS_M: Final = 6_378_137.0  # the Web Mercator sphere
_POINTS_IN_A_SEGMENT = 2


@dataclass(frozen=True, slots=True)
class LatLon:
    lat: float
    lon: float


@dataclass(frozen=True, slots=True)
class Place:
    """A point known both in LV95 metres (for measuring) and WGS84 degrees (for drawing)."""

    easting_m: float
    northing_m: float
    longitude: float
    latitude: float

    @property
    def lv95(self) -> Point:
        return (self.easting_m, self.northing_m)


def place_from_wgs84(latitude: float, longitude: float) -> Place:
    eastings, northings = lv95_from_wgs84_arrays(np.array([latitude]), np.array([longitude]))
    return Place(float(eastings[0]), float(northings[0]), longitude, latitude)


def lv95_from_wgs84_arrays(
    latitudes: FloatArray, longitudes: FloatArray
) -> tuple[FloatArray, FloatArray]:
    """(easting, northing) in metres for arrays of WGS84 degrees."""
    phi = (latitudes * _ARCSEC_PER_DEGREE - _ORIGIN_LATITUDE_ARCSEC) / _AUXILIARY_SCALE
    lam = (longitudes * _ARCSEC_PER_DEGREE - _ORIGIN_LONGITUDE_ARCSEC) / _AUXILIARY_SCALE
    easting = (
        2_600_072.37
        + 211_455.93 * lam
        - 10_938.51 * lam * phi
        - 0.36 * lam * phi**2
        - 44.54 * lam**3
    )
    northing = (
        1_200_147.07
        + 308_807.95 * phi
        + 3_745.25 * lam**2
        + 76.63 * phi**2
        - 194.56 * lam**2 * phi
        + 119.79 * phi**3
    )
    return easting, northing


def wgs84_from_lv95_arrays(
    eastings: FloatArray, northings: FloatArray
) -> tuple[FloatArray, FloatArray]:
    """(latitude, longitude) in degrees for arrays of LV95 metres."""
    y = (eastings - _LV95_FALSE_EASTING_M) / 1e6
    x = (northings - _LV95_FALSE_NORTHING_M) / 1e6
    longitude_aux = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x**2 - 0.0436 * y**3
    latitude_aux = (
        16.9023892
        + 3.238272 * x
        - 0.270978 * y**2
        - 0.002528 * x**2
        - 0.0447 * y**2 * x
        - 0.0140 * x**3
    )
    # The auxiliary values are in units of 10'000 arc seconds.
    to_degrees = _AUXILIARY_SCALE / _ARCSEC_PER_DEGREE
    return latitude_aux * to_degrees, longitude_aux * to_degrees


def lv95_easting(lat: float, lon: float) -> float:
    return place_from_wgs84(lat, lon).easting_m


def lv95_northing(lat: float, lon: float) -> float:
    return place_from_wgs84(lat, lon).northing_m


def mercator_y(latitudes: FloatArray) -> FloatArray:
    """Web Mercator y on the unit sphere, for latitudes in degrees."""
    return np.log(np.tan(np.pi / 4 + np.radians(latitudes) / 2))


def latitude_from_mercator_y(mercator: FloatArray) -> FloatArray:
    return np.degrees(2 * np.arctan(np.exp(mercator)) - np.pi / 2)


def simplify_indices(
    eastings: Sequence[float],
    northings: Sequence[float],
    tolerance_m: float,
    heights: Sequence[float] | None = None,
    vertical_tolerance_m: float = 1.0,
) -> list[int]:
    """Indices of the points Douglas-Peucker keeps, measured in metres.

    Returning indices (not coordinates) lets the caller keep the exact WGS84 values of the
    kept points, instead of simplifying in degrees, where east-west and north-south differ.
    With `heights`, a point is also kept when dropping it would move the profile by more than
    `vertical_tolerance_m` (a straight track crossing a valley keeps its dip).
    """
    count = len(eastings)
    if count <= _POINTS_IN_A_SEGMENT:
        return list(range(count))
    keep = [False] * count
    keep[0] = keep[-1] = True
    pending = [(0, count - 1)]
    while pending:
        first, last = pending.pop()
        farthest, farthest_excess = -1, 1.0
        for index in range(first + 1, last):
            distance, share = _distance_to_segment(
                (eastings[index], northings[index]),
                (eastings[first], northings[first]),
                (eastings[last], northings[last]),
            )
            excess = distance / tolerance_m
            if heights is not None:
                expected = heights[first] + share * (heights[last] - heights[first])
                excess = max(excess, abs(heights[index] - expected) / vertical_tolerance_m)
            if excess > farthest_excess:
                farthest, farthest_excess = index, excess
        if farthest >= 0:
            keep[farthest] = True
            pending.extend([(first, farthest), (farthest, last)])
    return [index for index, kept in enumerate(keep) if kept]


def _distance_to_segment(point: Point, start: Point, end: Point) -> tuple[float, float]:
    """Distance from `point` to the segment, and the share (0..1) along it of the nearest point."""
    along_east, along_north = end[0] - start[0], end[1] - start[1]
    length_squared = along_east**2 + along_north**2
    if length_squared == 0:
        return math.dist(point, start), 0.0
    share = (
        (point[0] - start[0]) * along_east + (point[1] - start[1]) * along_north
    ) / length_squared
    share = min(1.0, max(0.0, share))
    nearest = (start[0] + share * along_east, start[1] + share * along_north)
    return math.dist(point, nearest), share


def flat_lonlat(places: Sequence[Place]) -> list[float]:
    """[place, ...] -> [longitude, latitude, ...] with centimetre precision."""
    return [
        round(value, WGS84_DECIMALS)
        for place in places
        for value in (place.longitude, place.latitude)
    ]


# LV95 extent of Switzerland with a small margin; stops outside (Praha, Paris, ...) are dropped.
SWITZERLAND = Bounds(
    min_easting_m=2_480_000,
    max_easting_m=2_840_000,
    min_northing_m=1_070_000,
    max_northing_m=1_300_000,
)
