"""Loading a GTFS feed into DuckDB and selecting one service day.

The Swiss feed is large (stop_times.txt is about 3.7 GB), so everything stays in SQL and
only small, aggregated results are pulled into Python.
"""

from datetime import date
from pathlib import Path

import duckdb

from smb_pipeline.modes import layer_case_sql

GTFS_TABLES = (
    "routes",
    "trips",
    "stop_times",
    "stops",
    "calendar",
    "calendar_dates",
    "frequencies",
)

_WEEKDAY_COLUMNS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def register_feed(connection: duckdb.DuckDBPyConnection, gtfs_dir: Path) -> None:
    """Expose each GTFS file as a view `gtfs_<name>` with all columns as text."""
    for name in GTFS_TABLES:
        path = gtfs_dir / f"{name}.txt"
        if not path.exists():
            raise FileNotFoundError(f"GTFS file missing: {path}")
        connection.execute(
            f"CREATE OR REPLACE VIEW gtfs_{name} AS "
            f"SELECT * FROM read_csv('{path.as_posix()}', all_varchar = true, header = true)"
        )
    # "HH:MM:SS" -> seconds; GTFS hours may exceed 24 for service past midnight.
    connection.execute(
        "CREATE OR REPLACE MACRO hms(t) AS "
        "split_part(t, ':', 1)::INT * 3600 + split_part(t, ':', 2)::INT * 60 "
        "+ split_part(t, ':', 3)::INT"
    )


def materialize_service_day(connection: duckdb.DuckDBPyConnection, service_date: date) -> None:
    """Create `day_trips` and `day_stop_times` for every trip running on `service_date`.

    Frequency-based trips (frequencies.txt) are expanded into one trip per departure.
    """
    _materialize_active_services(connection, service_date)
    _materialize_trips(connection)
    _materialize_stop_times(connection)


def _materialize_active_services(connection: duckdb.DuckDBPyConnection, service_date: date) -> None:
    day = service_date.strftime("%Y%m%d")
    weekday = _WEEKDAY_COLUMNS[service_date.weekday()]
    connection.execute(
        f"""
        CREATE OR REPLACE TABLE day_services AS
        SELECT service_id FROM gtfs_calendar
         WHERE {weekday} = '1' AND start_date <= $day AND end_date >= $day
        UNION
        SELECT service_id FROM gtfs_calendar_dates WHERE date = $day AND exception_type = '1'
        EXCEPT
        SELECT service_id FROM gtfs_calendar_dates WHERE date = $day AND exception_type = '2'
        """,
        {"day": day},
    )


def _materialize_trips(connection: duckdb.DuckDBPyConnection) -> None:
    connection.execute(
        f"""
        CREATE OR REPLACE TABLE day_trips AS
        SELECT trip_id, layer FROM (
            SELECT t.trip_id, {layer_case_sql("r.route_type::INT")} AS layer
              FROM gtfs_trips t
              JOIN day_services USING (service_id)
              JOIN gtfs_routes r USING (route_id)
        ) WHERE layer IS NOT NULL
        """
    )


def _materialize_stop_times(connection: duckdb.DuckDBPyConnection) -> None:
    connection.execute(
        """
        CREATE OR REPLACE TABLE day_stop_times AS
        WITH base AS (
            SELECT st.trip_id,
                   st.stop_id,
                   st.stop_sequence::INT AS seq,
                   hms(coalesce(nullif(st.arrival_time, ''), st.departure_time)) AS arr,
                   hms(coalesce(nullif(st.departure_time, ''), st.arrival_time)) AS dep
              FROM gtfs_stop_times st SEMI JOIN day_trips USING (trip_id)
        ),
        freq AS (
            SELECT trip_id, hms(start_time) AS t0, hms(end_time) AS t1, headway_secs::INT AS headway
              FROM gtfs_frequencies SEMI JOIN day_trips USING (trip_id)
        ),
        instances AS (
            SELECT trip_id, unnest(range(t0, t1, headway)) AS start_s FROM freq
        ),
        first_dep AS (
            SELECT trip_id, min(dep) AS d0 FROM base SEMI JOIN freq USING (trip_id) GROUP BY trip_id
        )
        SELECT trip_id, trip_id AS template_id, stop_id, seq, arr, dep
          FROM base ANTI JOIN freq USING (trip_id)
        UNION ALL
        SELECT b.trip_id || '@' || i.start_s, b.trip_id, b.stop_id, b.seq,
               b.arr - f.d0 + i.start_s, b.dep - f.d0 + i.start_s
          FROM base b
          JOIN instances i USING (trip_id)
          JOIN first_dep f USING (trip_id)
        """
    )
