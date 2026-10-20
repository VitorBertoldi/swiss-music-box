import duckdb

Connection = duckdb.DuckDBPyConnection


def _scalars(connection: Connection, sql: str) -> list[object]:
    return [row[0] for row in connection.execute(sql).fetchall()]


def test_calendar_and_exceptions_select_the_running_trips(
    connection: Connection,
) -> None:
    trips = set(_scalars(connection, "SELECT trip_id FROM day_trips"))
    # T2 runs on Mondays only, T3 is removed by an exception, T6 (taxi) has no layer.
    assert trips == {"T1_ic", "T4_night_bus", "T5_cable_frequency", "T7_to_praha"}


def test_layers_follow_route_types(connection: Connection) -> None:
    layers = dict(connection.execute("SELECT trip_id, layer FROM day_trips").fetchall())
    assert layers["T1_ic"] == "long_rail"
    assert layers["T4_night_bus"] == "bus"
    assert layers["T5_cable_frequency"] == "aerial"


def test_frequency_trips_expand_into_one_trip_per_headway(
    connection: Connection,
) -> None:
    starts = _scalars(
        connection,
        "SELECT dep FROM day_stop_times WHERE template_id = 'T5_cable_frequency' AND seq = 1 "
        "ORDER BY dep",
    )
    assert starts == [8 * 3600, 8 * 3600 + 1200, 8 * 3600 + 2400]


def test_departures_skip_last_stop_and_wrap_after_midnight(
    connection: Connection,
) -> None:
    minutes = _scalars(
        connection, "SELECT minute FROM departures WHERE trip_id = 'T4_night_bus' ORDER BY minute"
    )
    assert minutes == [10, 23 * 60 + 50]  # 24:10 wraps to 00:10; 24:30 is the last stop


def test_platforms_collapse_to_parent_station(connection: Connection) -> None:
    parents = set(_scalars(connection, "SELECT parent_id FROM departures WHERE trip_id = 'T1_ic'"))
    assert parents == {"P_A", "P_B"}


def test_foreign_stops_are_outside_the_map(connection: Connection) -> None:
    assert _scalars(connection, "SELECT count(*) FROM parents WHERE parent_id = 'X'") == [0]
