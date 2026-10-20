"""Collapsing platforms to parent stations and placing them in LV95."""

import duckdb
import numpy as np
from duckdb.sqltypes import DOUBLE
from scipy.spatial import cKDTree

from smb_pipeline.contract import Bounds
from smb_pipeline.geo import lv95_easting, lv95_northing


def materialize_parents(connection: duckdb.DuckDBPyConnection, bounds: Bounds) -> None:
    """Create `stop_parent(stop_id, parent_id)` and `parents(parent_id, name, lat, lon,
    easting_m, northing_m)`.

    Only parents inside `bounds` are kept, which drops foreign stops of international trains.
    """
    connection.create_function("lv95_easting", lv95_easting, [DOUBLE, DOUBLE], DOUBLE)
    connection.create_function("lv95_northing", lv95_northing, [DOUBLE, DOUBLE], DOUBLE)
    connection.execute(
        """
        CREATE OR REPLACE TABLE stop_parent AS
        SELECT stop_id, coalesce(nullif(parent_station, ''), stop_id) AS parent_id FROM gtfs_stops
        """
    )
    connection.execute(
        """
        CREATE OR REPLACE TABLE parents AS
        SELECT * FROM (
            SELECT stop_id AS parent_id, stop_name AS name,
                   stop_lat::DOUBLE AS lat, stop_lon::DOUBLE AS lon,
                   lv95_easting(stop_lat::DOUBLE, stop_lon::DOUBLE) AS easting_m,
                   lv95_northing(stop_lat::DOUBLE, stop_lon::DOUBLE) AS northing_m
              FROM gtfs_stops
             WHERE stop_id IN (SELECT parent_id FROM stop_parent)
        )
        WHERE easting_m BETWEEN $min_easting_m AND $max_easting_m
          AND northing_m BETWEEN $min_northing_m AND $max_northing_m
        """,
        bounds.model_dump(),
    )


class StationLocator:
    """Finds the nearest station name to a point; used to name unnamed OSM tunnels."""

    def __init__(self, connection: duckdb.DuckDBPyConnection) -> None:
        rows = connection.execute(
            "SELECT name, easting_m, northing_m FROM parents "
            "WHERE parent_id IN (SELECT parent_id FROM departures WHERE layer <> 'bus')"
        ).fetchall()
        self._names = [name for name, _, _ in rows]
        self._tree = cKDTree(np.array([(easting, northing) for _, easting, northing in rows]))

    def nearest_name(self, easting_m: float, northing_m: float) -> str:
        _, index = self._tree.query((easting_m, northing_m))
        return str(self._names[int(index)])
