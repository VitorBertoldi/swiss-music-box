"""The week-one explorations: what the data looks like before it becomes music.

Everything is computed from a day file, so explorations run in a second and need no GTFS.
Note-layer counts are per (minute, station, layer) as stored in the day file.
"""

from statistics import quantiles

from pydantic import BaseModel, ConfigDict

from smb_pipeline.contract import MINUTES_PER_DAY, Day, NoteLayer, TextureLayer
from smb_pipeline.modes import NOTE_LAYERS

HOURS = 24
MINUTES_PER_HOUR = 60
ELEVATION_BIN_M = 100
DURATIONS_S = (180, 600, 1200)
PULSE_MINUTES = (0, 30)

Layer = NoteLayer | TextureLayer


class Findings(BaseModel):
    model_config = ConfigDict(frozen=True)

    service_date: str
    departures_per_hour: dict[Layer, list[int]]
    """1. Data anatomy: departures per hour of day, per layer."""
    minute_of_hour: dict[Layer, list[int]]
    """2. Rhythm: departures by minute past the hour, per layer."""
    pulse_ratio: dict[Layer, float]
    """2. Rhythm: departures at :00/:30 relative to an average minute (1.0 = no pulse)."""
    elevation_histogram: list[int]
    """3. Altitude: number of note stations per 100 m band, from 0 m."""
    elevation_percentiles: dict[str, float]
    unthinned_notes_per_second: dict[NoteLayer, dict[int, float]]
    """4. Density: notes/s each layer would produce without a budget, per day length (s)."""
    tunnel_train_minutes_per_hour: dict[str, list[int]]
    """5. Tunnels: minutes spent inside by all trains, per hour."""


def explore(day: Day) -> Findings:
    per_minute = _departures_per_minute(day)
    return Findings(
        service_date=day.service_date,
        departures_per_hour={layer: _per_hour(counts) for layer, counts in per_minute.items()},
        minute_of_hour={layer: _minute_of_hour(counts) for layer, counts in per_minute.items()},
        pulse_ratio={layer: _pulse_ratio(counts) for layer, counts in per_minute.items()},
        elevation_histogram=_histogram([s.elevation_m for s in day.stations], ELEVATION_BIN_M),
        elevation_percentiles=_percentiles([s.elevation_m for s in day.stations]),
        unthinned_notes_per_second={
            layer: {d: round(sum(per_minute[layer]) / d, 1) for d in DURATIONS_S}
            for layer in NOTE_LAYERS
        },
        tunnel_train_minutes_per_hour={t.name: _per_hour(t.occupancy) for t in day.tunnels},
    )


def _departures_per_minute(day: Day) -> dict[Layer, list[int]]:
    counts: dict[Layer, list[int]] = {layer: [0] * MINUTES_PER_DAY for layer in NOTE_LAYERS}
    for minute, layer in zip(day.notes.minute, day.notes.layer, strict=True):
        counts[layer][minute] += 1
    for texture in day.textures:
        counts[texture.layer] = [sum(row) for row in texture.counts]
    return counts


def _per_hour(per_minute: list[int]) -> list[int]:
    return [
        sum(per_minute[h * MINUTES_PER_HOUR : (h + 1) * MINUTES_PER_HOUR]) for h in range(HOURS)
    ]


def _minute_of_hour(per_minute: list[int]) -> list[int]:
    return [sum(per_minute[m::MINUTES_PER_HOUR]) for m in range(MINUTES_PER_HOUR)]


def _pulse_ratio(per_minute: list[int]) -> float:
    by_minute = _minute_of_hour(per_minute)
    average = sum(by_minute) / MINUTES_PER_HOUR
    if average == 0:
        return 0.0
    return round(sum(by_minute[m] for m in PULSE_MINUTES) / len(PULSE_MINUTES) / average, 2)


def _histogram(values: list[float], bin_size: int) -> list[int]:
    bins = [0] * (int(max(values, default=0) // bin_size) + 1)
    for v in values:
        bins[int(v // bin_size)] += 1
    return bins


def _percentiles(values: list[float]) -> dict[str, float]:
    if len(values) < 2:  # quantiles needs at least two points
        return {}
    deciles = quantiles(values, n=10)
    return {"p10": deciles[0], "p50": deciles[4], "p90": deciles[8], "max": max(values)}
