"""Turning the service day into departure events and textures."""

from collections.abc import Sequence
from dataclasses import dataclass

import duckdb

from smb_pipeline.contract import (
    MINUTES_PER_DAY,
    Bounds,
    NoteEvents,
    NoteLayer,
    TextureLayer,
    TextureSeries,
)
from smb_pipeline.geo import LatLon
from smb_pipeline.modes import NOTE_LAYERS, TEXTURE_LAYERS


@dataclass(frozen=True, slots=True)
class StationRow:
    parent_id: str
    name: str
    position: LatLon
    easting_m: float
    northing_m: float


def materialize_departures(connection: duckdb.DuckDBPyConnection) -> None:
    """Create `departures(trip_id, layer, parent_id, minute, trip_start)`.

    A departure is every stop of a trip except its last one. Times after 24:00 wrap onto the
    same day, so the late-night service of the previous evening fills the small hours.
    """
    connection.execute(
        f"""
        CREATE OR REPLACE TABLE departures AS
        WITH whole_trips AS (
            -- Decide first/last stop over the whole trip, before dropping foreign stops.
            SELECT st.trip_id, t.layer, sp.parent_id,
                   (st.dep // 60) % {MINUTES_PER_DAY} AS minute,
                   st.seq = min(st.seq) OVER trip AS trip_start,
                   st.seq = max(st.seq) OVER trip AS trip_end
              FROM day_stop_times st
              JOIN day_trips t ON t.trip_id = st.template_id
              JOIN stop_parent sp USING (stop_id)
            WINDOW trip AS (PARTITION BY st.trip_id)
        )
        SELECT trip_id, layer, parent_id, minute, trip_start
          FROM whole_trips SEMI JOIN parents USING (parent_id)
         WHERE NOT trip_end
        """
    )


def note_stations(connection: duckdb.DuckDBPyConnection) -> list[StationRow]:
    """Parent stations with at least one note-layer departure, ordered by name."""
    rows = connection.execute(
        """
        SELECT p.parent_id, p.name, p.lat, p.lon, p.easting_m, p.northing_m
          FROM parents p
         WHERE p.parent_id IN (SELECT parent_id FROM departures WHERE layer IN $layers)
         ORDER BY p.name, p.parent_id
        """,
        {"layers": list(NOTE_LAYERS)},
    ).fetchall()
    return [
        StationRow(parent_id, name, LatLon(lat, lon), easting_m, northing_m)
        for parent_id, name, lat, lon, easting_m, northing_m in rows
    ]


def note_events(
    connection: duckdb.DuckDBPyConnection, stations: Sequence[StationRow]
) -> NoteEvents:
    """Note-layer departures, one per (minute, station, layer), ordered by time."""
    connection.execute(
        "CREATE OR REPLACE TEMP TABLE station_index (parent_id VARCHAR, idx INTEGER)"
    )
    connection.executemany(
        "INSERT INTO station_index VALUES (?, ?)",
        [(s.parent_id, i) for i, s in enumerate(stations)],
    )
    rows: list[tuple[int, int, NoteLayer, bool]] = connection.execute(
        """
        SELECT d.minute, si.idx, d.layer, bool_or(d.trip_start)
          FROM departures d JOIN station_index si USING (parent_id)
         WHERE d.layer IN $layers
         GROUP BY ALL
         ORDER BY d.minute, si.idx, d.layer
        """,
        {"layers": list(NOTE_LAYERS)},
    ).fetchall()
    return NoteEvents(
        minute=[minute for minute, _, _, _ in rows],
        station=[station for _, station, _, _ in rows],
        layer=[layer for _, _, layer, _ in rows],
        trip_start=[trip_start for _, _, _, trip_start in rows],
    )


def textures(
    connection: duckdb.DuckDBPyConnection, bounds: Bounds, bins: int
) -> list[TextureSeries]:
    """Departure counts per texture layer, minute and west-to-east bin."""
    rows: list[tuple[TextureLayer, int, int, int]] = connection.execute(
        """
        SELECT d.layer, d.minute,
               least(
                   $bins - 1,
                   floor($bins * (p.easting_m - $min_easting_m)
                         / ($max_easting_m - $min_easting_m))
               )::INT AS bin,
               count(*)
          FROM departures d JOIN parents p USING (parent_id)
         WHERE d.layer IN $layers
         GROUP BY ALL
        """,
        {
            "bins": bins,
            "layers": list(TEXTURE_LAYERS),
            "min_easting_m": bounds.min_easting_m,
            "max_easting_m": bounds.max_easting_m,
        },
    ).fetchall()
    grids: dict[TextureLayer, list[list[int]]] = {
        layer: [[0] * bins for _ in range(MINUTES_PER_DAY)] for layer in TEXTURE_LAYERS
    }
    for layer, minute, bin_index, count in rows:
        grids[layer][minute][bin_index] = count
    return [TextureSeries(layer=layer, counts=grid) for layer, grid in grids.items()]
