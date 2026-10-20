import base64
import gzip
import zipfile
from pathlib import Path

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from smb_pipeline.contract import AssetBundle
from smb_pipeline.map_assets import (
    FONT_STACKS,
    GLYPH_RANGES,
    extract_fonts,
    tile_range,
    write_overview_tiles,
)

SWITZERLAND = (5.9, 45.8, 10.5, 47.85)


def test_zoom_zero_is_one_tile() -> None:
    assert tile_range(0, *SWITZERLAND).tiles() == [(0, 0, 0)]


def test_switzerland_at_zoom_eight_is_a_handful_of_tiles() -> None:
    covering = tile_range(8, *SWITZERLAND)
    assert (covering.min_x, covering.max_x) == (132, 135)
    assert (covering.min_y, covering.max_y) == (89, 91)


def test_overview_tiles_are_bundled_per_zoom_uncompressed(tmp_path: Path) -> None:
    archive = tmp_path / "tiny.pmtiles"
    with archive.open("wb") as file:
        writer = Writer(file)
        writer.write_tile(zxy_to_tileid(0, 0, 0), gzip.compress(b"world"))
        writer.write_tile(zxy_to_tileid(1, 1, 0), gzip.compress(b"north-east"))
        writer.finalize(
            {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP},
            {"name": "tiny"},
        )
    count = write_overview_tiles(archive, tmp_path / "tiles", SWITZERLAND, max_zoom=1)
    assert count == 2
    bundle = AssetBundle.model_validate_json((tmp_path / "tiles" / "zoom-1.json").read_text())
    assert base64.b64decode(bundle.entries["1/0"]) == b"north-east"


def test_fonts_are_unpacked_and_bundled(tmp_path: Path) -> None:
    font_zip = tmp_path / "fonts.zip"
    with zipfile.ZipFile(font_zip, "w") as archive:
        for stack in FONT_STACKS:
            for glyph_range in GLYPH_RANGES:
                archive.writestr(f"{stack}/{glyph_range}.pbf", b"glyphs")
    written = extract_fonts(font_zip, tmp_path / "fonts")
    assert written == len(FONT_STACKS) * len(GLYPH_RANGES)
    assert (tmp_path / "fonts" / "Noto Sans Regular" / "0-255.pbf").read_bytes() == b"glyphs"
    bundle = AssetBundle.model_validate_json((tmp_path / "fonts" / "glyphs.json").read_text())
    assert base64.b64decode(bundle.entries["Noto Sans Regular/0-255"]) == b"glyphs"
