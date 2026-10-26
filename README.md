# Swiss Music Box

Every public-transport departure in Switzerland on one day, played as music.
A day lasts 3 minutes (or 10 or 20), and each timetable minute is a 16th note at 120 BPM.

| Data | Sound |
|---|---|
| IC/IR trains, mountain railways, boats, cable cars, funiculars | individual notes (FM piano, glass, horn, bells, pluck) |
| Station altitude | pitch (rank-mapped, snapped to the chord of the hour) |
| West ↔ east (Genève ↔ Val Müstair) | stereo position |
| S-Bahn, trams, buses | textures (pad, shimmer, noise "rain") whose volume follows activity |
| Trains inside the Gotthard, Ceneri, Lötschberg, … | low drones |

## How OpenStreetMap is used

Everything you see is OpenStreetMap (OSM), down to individual buildings, and every vehicle moves
on OSM geometry, stored to the centimetre.

| OSM data | What it becomes |
|---|---|
| the whole extract | **vector tiles** built with [Planetiler](https://github.com/onthegomap/planetiler) (OpenMapTiles schema, zoom 0–14, `make tiles`): streets with names, footpaths and cycleways, land use, water, 3D buildings, peaks, places |
| `railway=rail / narrow_gauge / funicular` (+ rack) | the **rail graph**: trains and funiculars are routed stop to stop along the real track (Dijkstra, `pipeline/.../routing.py`) |
| `tunnel=yes` on rail ways | **tunnels**: tubes grouped by name, unnamed ones named after the nearest station. Trains dim while inside; the 8 longest busy tunnels glow and **drone** in the music |
| `route=ferry` | the **ferry graph**: boats sail real lake routes |
| `boundary=administrative` + `ISO3166-1=CH` | the mask that cuts the relief to Switzerland's shape |

Routing coverage on 21 Oct 2026: 100 % of IC/IR stop pairs and 98 % of regional and mountain rail
pairs inside Switzerland follow OSM track; the rest (mostly funiculars) are straight lines.
Stations beyond the extract (German shore of Lake Constance, …) leave the map at the border.
The relief is Copernicus GLO-90 (not OSM), cached under `data/cache/dem`.

## Zooming in

Drag to pan, scroll to zoom, right-drag (or Ctrl-drag) to tilt and rotate; touching the map
switches the camera to **free**. Vehicles are computed every frame from the exact track
geometry: a train has a body of its real length (an IC ~400 m), eases in and out of stations,
waits at platforms and disappears into tunnels.

From zoom 14 each kind of vehicle is drawn as what it is (`web/src/vehicles/`): trains as a row of
3D cars that bends with the track, boats as a hull with a wake, cable cars as a cabin hanging from
a sagging cable, funiculars as one long car. Further out they stay dots with trails.

A view can be shared as a link: `?view=longitude,latitude,zoom,pitch,bearing`, e.g.

- Zürich HB from above the rooftops: `?view=8.5402,47.3779,16,60,-30`
- Bern station: `?view=7.4392,46.949,15.5,55,20`
- the Gotthard north portal at Erstfeld: `?view=8.66,46.82,13.5,45,160`

**Local vs shared link.** Locally (`make dev`) the map reads the full 349 MB tile file with HTTP
range requests, down to street level. The shared artifact link can't host it, so the player
detects that and falls back to bundled overview tiles (zoom ≤ 10, `make overview`).

## Architecture

```
GTFS ─┐                                     ┌─ <date>.json         sound: notes, textures, tunnel drones
OSM  ─┼─► pipeline/ (Python, DuckDB, ───────┼─ motion-<date>.json  every vehicle on OSM paths (WGS84, 1 cm)
DEM  ─┘    pyosmium, scipy)                 ├─ relief.json + PNG   shaded relief, Web-Mercator aligned
OSM  ───► Planetiler (Java) ────────────────┴─ tiles/switzerland.pmtiles   the street map
                                                     │  contract/ (Pydantic → JSON Schema → TS types)
                                                     ▼
web/ (TypeScript)  music core (pure) ─► outputs: Tone.js · Web MIDI · .mid
                   map (MapLibre 5) + render (deck.gl, interleaved) ─► scenes: living map · long exposure · calibration
                   camera: overview · tour · follow · free    stage: crossfades scenes, runs the frame loop
```

MapLibre is pinned to 5.x: deck.gl 9.4's interleaved overlay reads MapLibre internals that 6.x changed.

Design patterns, where they earn their place:

| Pattern | Where |
|---|---|
| Pipeline of named steps + **Facade** | `smb build` / `smb relief` → `build_day`, `build_relief` |
| **Adapter** | `osm.py` (the only module that touches pyosmium); `map/mapView.ts` (the only one that touches MapLibre); `ScoreSink` outputs (Tone, Web MIDI, .mid) |
| **Strategy** + composition | `VehicleKind` (`TrainKind`, `BoatKind`, `CableCarKind`), each built from a `MotionModel` (where its parts stand) and a `Shape` (what they look like) |
| **Strategy** | `Scene`, `CameraMode` (overview/tour/follow/free), `TileSource` (pmtiles/bundle), `Palette` (screen/projector), `PitchMapping`, `ElevationProvider` / `HeightModel` |
| **Builder** | `NetworkGraphBuilder` (OSM ways → graph), `buildStyle` (MapLibre style), `VehicleTrackBuilder` (motion → GPU tracks) |
| **Registry** | `SceneRegistry`: one list of scenes, numbered like their keys; `VehicleKindRegistry`: one kind per moving layer, checked at start-up |
| **Observer** | `Player.onNote` → station flashes; visuals and sound stay decoupled |

## Projector

Keys: **Space** play · **1** living map · **2** long exposure · **3** calibration ·
**O** overview · **T** camera tour · **G** follow a train · **M** free camera ·
**P** projector mode (no UI, no cursor, 16:9 letterbox, brighter map) · **H** hide panel · **F** fullscreen.

In the room: open scene 3 first. The grid shows focus and keystone, the ramps show black level and
colour, and the read-out gives the real resolution and frame rate. `make smoke` renders every scene and
several street-level views at 1080p and 4K into `explorations/screens/` to check before going.

## Quick start

Needs `uv`, Node ≥ 22, Java 25 (for Planetiler) and `make`.

```sh
make setup        # Python + Node dependencies
make data         # downloads GTFS + OSM (+ ~1 GB of Planetiler sources once), builds everything (~5 min)
make dev          # open the printed URL in Chrome, press Space
make check        # ruff, mypy --strict, pytest, biome, tsc --strict, vitest: what CI runs
make smoke        # screenshots of every scene and street views at 1080p and 4K
make overview     # bundled low-zoom tiles for hosts without range requests (the shared link)
```

Other days: `make day DATE=2026-10-25` (the 2026 feed covers 14 Dec 2025 – 12 Dec 2026).
The player currently loads the day named in `web/src/main.ts`.

## Ableton Live

**From a file:** in the panel choose the day length and click **Export .mid for Ableton**, then drag it
into Ableton. Tempo is set so the day lasts exactly the chosen length; there is one track per layer.

**Live:** macOS → *Audio MIDI Setup* → *Window ▸ Show MIDI Studio* → double-click **IAC Driver** →
tick *Device is online*. In the player pick *MIDI out: IAC Driver Bus 1* (Chrome; Safari has no Web MIDI).
In Ableton, enable the IAC input (*Track* and *Remote*) and set each track's input channel:

| Channel | What |
|---|---|
| 1–5 | IC/IR, mountain railways, boats, cable cars, funiculars (or 1–15 with "per layer × zone": west/centre/east of each, pan them in Ableton) |
| 16 | the chord of the hour as held notes, plus every level as a CC |
| CC 20–28 on ch 16 | S-Bahn, trams, buses × west/centre/east (MIDI-learn them onto pad volume, filters, …) |
| CC 30–37 on ch 16 | tunnel drones, one per tunnel |

Uncheck *Browser synth* when Ableton makes the sound.

## Week-one findings (Wed 21 Oct 2026)

`make data && cd pipeline && uv run smb explore --day ../web/public/data/2026-10-21.json --out ../explorations/findings-2026-10-21.json`

- **Anatomy:** about 2.8 M departures, 2.3 M of them buses. Near silence 02:00–04:00, peaks at 07:00 and 17:00.
  Cable cars run on their own clock: from 09:00, done by 17:00.
- **Rhythm:** no clock-face pulse for buses and trams. IC trains cluster in the minutes *after* :00 and :30
  (the hub principle); boats (4×) and funiculars (3×) pulse the most.
- **Altitude:** median station 648 m, with a crowd at 400–500 m, hence rank mapping rather than linear.
- **Density:** unthinned, a 3-minute day would need about 390 cable-car notes/s and 54 IC notes/s, hence the
  30 notes/s budget. At 20 minutes, IC trains (~8/s) could almost play unthinned.
- **Tunnels:** about 3 trains are inside the Gotthard Base Tunnel during every daytime hour, so its drone never stops.

## Known limits / next steps for the group

- Speed along a leg follows the timetable with eased starts and stops, not real acceleration curves.
- The tunnel glow is drawn along the tunnel's axis (portal to portal), not its exact curve.
- The map is flat, so cable cars hang at a fixed 60 m above it instead of climbing the mountain, and
  funiculars are not tilted; both need 3D terrain.
- Buses and trams are sound textures only; moving them on OSM streets is the natural next step.
- 3D terrain (stretch goal): MapLibre can drape the map over a DEM (`raster-dem` source) so mountains
  rise and cable cars climb; the relief image would become terrain tiles.
- Real delays (opentransportdata.swiss *Ist-Daten*) as detune or dissonance; Sunday vs weekday; live GTFS-RT.
- Browser MIDI scheduling looks 150 ms ahead, so pausing can leave a few already-sent notes.
