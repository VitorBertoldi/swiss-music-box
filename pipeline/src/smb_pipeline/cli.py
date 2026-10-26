"""Command line for the pipeline; `uv run smb --help` lists every command."""

import json
from datetime import datetime
from pathlib import Path
from typing import Annotated

import typer

from smb_pipeline.build import build_day
from smb_pipeline.contract import Day, json_schemas
from smb_pipeline.dem import CopernicusDem, DemElevation, SmoothedDem
from smb_pipeline.explore import explore as run_explorations
from smb_pipeline.map_assets import extract_fonts, write_overview_tiles
from smb_pipeline.relief import build_relief
from smb_pipeline.terrain_tiles import write_terrain_tiles

app = typer.Typer(no_args_is_help=True, help="Swiss Music Box data pipeline.")

DEFAULT_DEM_CACHE = Path("../data/cache/dem")
# West, south, east, north in degrees, with a margin around the border.
SWITZERLAND_LONLAT = (5.9, 45.8, 10.5, 47.85)


@app.command()
def build(
    gtfs_dir: Annotated[Path, typer.Option(help="Unzipped GTFS feed directory")],
    osm: Annotated[Path, typer.Option(help="OpenStreetMap extract (.osm.pbf)")],
    service_date: Annotated[datetime, typer.Option("--date", formats=["%Y-%m-%d"])],
    out_dir: Annotated[Path, typer.Option(help="Directory for <date>.json and motion-<date>.json")],
    dem_cache: Annotated[Path, typer.Option()] = DEFAULT_DEM_CACHE,
) -> None:
    """Build the sound (`<date>.json`) and motion (`motion-<date>.json`) files for one day."""
    dem = CopernicusDem(dem_cache)
    result = build_day(gtfs_dir, osm, service_date.date(), DemElevation(dem), SmoothedDem(dem))
    date_text = result.day.service_date
    out_dir.mkdir(parents=True, exist_ok=True)
    _write(out_dir / f"{date_text}.json", result.day.model_dump_json())
    _write(out_dir / f"motion-{date_text}.json", result.motion.model_dump_json())
    typer.echo("Distinct stop pairs by layer and route:")
    for (layer, route), count in sorted(result.routing.pairs.items()):
        typer.echo(f"  {layer:14} {route:12} {count:6}")
    for layer, count in sorted(result.routing.outside_extract.items()):
        typer.echo(f"  {layer:14} {'outside map':12} {count:6}  (station beyond the OSM extract)")
    typer.echo("Drone tunnels: " + ", ".join(tunnel.name for tunnel in result.day.tunnels))


@app.command()
def relief(
    osm: Annotated[Path, typer.Option(help="OpenStreetMap extract (.osm.pbf), for the border")],
    out: Annotated[Path, typer.Option(help="Relief description (.json); the PNG goes next to it")],
    dem_cache: Annotated[Path, typer.Option()] = DEFAULT_DEM_CACHE,
) -> None:
    """Render the shaded relief of Switzerland, aligned with the map tiles."""
    out.parent.mkdir(parents=True, exist_ok=True)
    result = build_relief(osm, CopernicusDem(dem_cache), out.with_suffix(".png"))
    _write(out, result.model_dump_json())


@app.command()
def fonts(
    zip_path: Annotated[Path, typer.Option("--zip", help="openmaptiles/fonts release zip")],
    out_dir: Annotated[Path, typer.Option(help="Glyph directory served next to the map")],
) -> None:
    """Unpack the label glyphs the map style uses."""
    typer.echo(f"wrote {extract_fonts(zip_path, out_dir)} glyph files to {out_dir}")


@app.command()
def overview_tiles(
    pmtiles: Annotated[Path, typer.Option(help="Full vector tiles (.pmtiles)")],
    out_dir: Annotated[Path, typer.Option(help="Directory for z/x/y.pbf files")],
) -> None:
    """Copy the low zoom levels to plain files, for hosts without HTTP range requests."""
    count = write_overview_tiles(pmtiles, out_dir, SWITZERLAND_LONLAT)
    typer.echo(f"wrote {count} tiles to {out_dir}")


@app.command()
def terrain_tiles(
    out: Annotated[Path, typer.Option(help="Terrain tiles (.pmtiles), Terrarium-encoded PNGs")],
    dem_cache: Annotated[Path, typer.Option()] = DEFAULT_DEM_CACHE,
) -> None:
    """Encode the Copernicus terrain as tiles MapLibre can raise the 3D map over."""
    count = write_terrain_tiles(SmoothedDem(CopernicusDem(dem_cache)), out, SWITZERLAND_LONLAT)
    typer.echo(f"wrote {count} terrain tiles to {out} ({out.stat().st_size / 1e6:.1f} MB)")


@app.command()
def explore(
    day_file: Annotated[Path, typer.Option("--day", help="Day file built by `smb build`")],
    out: Annotated[Path, typer.Option(help="Findings output file (.json)")],
) -> None:
    """Compute the week-one explorations (anatomy, rhythm, altitude, density, tunnels)."""
    findings = run_explorations(Day.model_validate_json(day_file.read_text()))
    out.parent.mkdir(parents=True, exist_ok=True)
    _write(out, findings.model_dump_json(indent=1))


@app.command()
def schema(out_dir: Annotated[Path, typer.Option(help="Directory for <name>.schema.json")]) -> None:
    """Export every contract file as JSON Schema."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for stem, schema_document in json_schemas().items():
        _write(out_dir / f"{stem}.schema.json", json.dumps(schema_document, indent=2) + "\n")


def _write(path: Path, text: str) -> None:
    path.write_text(text)
    typer.echo(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")
