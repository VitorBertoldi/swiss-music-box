"""Classification of GTFS (extended) route types into the player's layers."""

from typing import Final, get_args

from smb_pipeline.contract import NoteLayer, TextureLayer

Layer = NoteLayer | TextureLayer

# Inclusive route_type ranges per layer. Anything unlisted (taxis, coaches) is ignored.
ROUTE_TYPE_RANGES: Final[dict[Layer, tuple[tuple[int, int], ...]]] = {
    "long_rail": ((101, 103),),  # IC/EC, IR, high speed
    "mountain_rail": ((107, 107), (116, 116)),  # tourist and rack railways
    "boat": ((1000, 1099),),
    "aerial": ((1300, 1399),),  # cable cars, gondolas, chairlifts
    "funicular": ((1400, 1499),),
    "regional_rail": ((100, 100), (104, 106), (108, 115), (117, 199)),
    "tram": ((900, 999), (400, 499)),  # trams and the Lausanne metro
    "bus": ((700, 799), (200, 299)),
}

NOTE_LAYERS: Final[tuple[NoteLayer, ...]] = get_args(NoteLayer)
TEXTURE_LAYERS: Final[tuple[TextureLayer, ...]] = get_args(TextureLayer)


def layer_of(route_type: int) -> Layer | None:
    for layer, ranges in ROUTE_TYPE_RANGES.items():
        if any(low <= route_type <= high for low, high in ranges):
            return layer
    return None


def layer_case_sql(column: str) -> str:
    """A SQL CASE expression mapping an integer route_type column to its layer name."""
    branches = " ".join(
        f"WHEN {column} BETWEEN {low} AND {high} THEN '{layer}'"
        for layer, ranges in ROUTE_TYPE_RANGES.items()
        for low, high in ranges
    )
    return f"CASE {branches} ELSE NULL END"
