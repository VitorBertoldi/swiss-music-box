import numpy as np
import pytest

from smb_pipeline.dem import DemElevation, hillshade, tile_name
from smb_pipeline.geo import FloatArray, LatLon


class SlopeTerrain:
    """A plane rising towards `uphill` (east or west) by one metre per 100 m."""

    def __init__(self, rises_to_the_east: bool) -> None:
        self._sign = 1 if rises_to_the_east else -1

    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        metres_east = (longitudes - 8.0) * 76_000
        return self._sign * metres_east / 100 + 0 * latitudes


def test_tile_names_follow_the_copernicus_scheme() -> None:
    assert tile_name(46, 8) == "Copernicus_DSM_COG_30_N46_00_E008_00_DEM"


def test_slopes_facing_the_north_west_light_are_brighter() -> None:
    columns = np.arange(20, dtype=np.float64)
    rising_to_the_east = np.tile(columns * 10, (20, 1))
    pixel_size_m = np.full(20, 100.0)
    facing_west = np.asarray(hillshade(rising_to_the_east, pixel_size_m))
    facing_east = np.asarray(hillshade(-rising_to_the_east, pixel_size_m))
    assert facing_west.mean() > facing_east.mean()


def test_dem_elevation_reads_heights_at_station_positions() -> None:
    elevation = DemElevation(SlopeTerrain(rises_to_the_east=True))
    assert elevation.elevations([LatLon(46.5, 8.1)]) == [pytest.approx(76.0)]
