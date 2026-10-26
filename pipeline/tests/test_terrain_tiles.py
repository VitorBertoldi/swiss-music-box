from pathlib import Path

import numpy as np
from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import TileType

from smb_pipeline.geo import FloatArray
from smb_pipeline.terrain_tiles import (
    TILE_SIZE_PX,
    decode_terrarium,
    encode_terrarium,
    pixel_centres,
    write_terrain_tiles,
)


class TiltedPlane:
    """Heights rising 1 m per 0.001 degree of longitude, from 500 m at 8 degrees east."""

    def heights(self, latitudes: FloatArray, longitudes: FloatArray) -> FloatArray:
        return 500 + (longitudes - 8.0) * 1000 + 0 * latitudes


def test_terrarium_round_trips_heights_to_millimetres() -> None:
    heights = np.array([[-12.3, 0.0, 372.25], [1234.5, 4634.0, 8848.86]])
    decoded = decode_terrarium(encode_terrarium(heights))
    assert np.allclose(decoded, heights, atol=0.004)


def test_pixel_centres_cover_the_tile_from_north_west() -> None:
    latitudes, longitudes = pixel_centres(1, 1, 0)
    assert latitudes.shape == longitudes.shape == (TILE_SIZE_PX, TILE_SIZE_PX)
    assert 0 < longitudes[0, 0] < longitudes[0, -1] < 180
    assert 85.06 > latitudes[0, 0] > latitudes[-1, 0] > 0


def test_terrain_tiles_are_png_and_carry_the_heights(tmp_path: Path) -> None:
    out = tmp_path / "terrain.pmtiles"
    count = write_terrain_tiles(TiltedPlane(), out, (7.9, 46.9, 8.1, 47.0), max_zoom=3)
    assert count == 4
    with out.open("rb") as file:
        reader = Reader(MmapSource(file))
        assert reader.header()["tile_type"] == TileType.PNG
        assert reader.header()["max_zoom"] == 3
        assert reader.get(3, 4, 2)
