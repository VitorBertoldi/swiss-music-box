"""Which OSM tunnels become drones in the music."""

from collections.abc import Sequence
from typing import Final

from smb_pipeline.contract import Motion, TunnelSeries
from smb_pipeline.geo import place_from_wgs84

# One MIDI CC per drone (CC 30-37), and more than eight drones blur into one rumble.
MAX_DRONE_TUNNELS: Final = 8


def drone_tunnels(motion: Motion, occupancy: Sequence[Sequence[int]]) -> list[TunnelSeries]:
    """The longest tunnels that trains actually use, longest first."""
    used = [index for index, minutes in enumerate(occupancy) if any(minutes)]
    longest = sorted(used, key=lambda index: motion.tunnels[index].length_m, reverse=True)
    return [_series(motion, index, occupancy[index]) for index in longest[:MAX_DRONE_TUNNELS]]


def _series(motion: Motion, index: int, minutes: Sequence[int]) -> TunnelSeries:
    tunnel = motion.tunnels[index]
    start_longitude, start_latitude, end_longitude, end_latitude = tunnel.coordinates[:4]
    centre = place_from_wgs84(
        (start_latitude + end_latitude) / 2, (start_longitude + end_longitude) / 2
    )
    return TunnelSeries(
        id=tunnel.id,
        name=tunnel.name,
        easting_m=round(centre.easting_m),
        northing_m=round(centre.northing_m),
        occupancy=list(minutes),
    )
