# Swiss Music Box: Data Group Guide

Everything the data group needs to start: what you own, where the data comes from, what you
deliver, how to build it, and how to check it.

Status on 3 Nov 2026: one day (Wed 21 Oct 2026) has been built end to end as a **prototype**,
loaded into PostgreSQL, checked, and restored from a Docker image. The prototype lives outside
the repo (`~/smb-trial-db/`); turning it into part of `pipeline/` is the group's first job.

---

## 1. Your role

The data group turns public raw data into **clean, checked, versioned facts** about Swiss public
transport, and publishes them for the other groups.

| The data group is responsible for | Not responsible for |
|---|---|
| Downloading the sources and recording their exact versions | What the data *means* at runtime, e.g. where a train is now (backend domain) |
| Selecting dates, cleaning, classifying, routing on OSM, adding heights | REST APIs and Java code (backend) |
| The database schema (the contract with the backend) | Drawing the map or vehicles (frontend) |
| Validation: nothing is published unless the checks pass | Music (later, separate) |
| Publishing the database image and the map files | |

**Rule of thumb:** the database stores *facts* ("IC 712 leaves Zürich HB at 09:32"). It never
stores anything computed per second (positions) and never stores display or music choices.

---

## 2. Architecture

```
                         DATA GROUP: pipeline (Python, runs on demand)
GTFS ─┐   ┌──────────────────────────────────────────────────────────────────┐
OSM  ─┼──►│ 1 EXTRACT  2 TRANSFORM  3 LOAD  4 VALIDATE  5 PUBLISH            │
DEM  ─┘   └──────────────────────────────────────────────────────────────────┘
                   │                                         │
                   ▼                                         ▼
   Database image (GHCR)                           Map files (GitHub Release)
   ghcr.io/vitorbertoldi/smb-data:<version>        tiles, terrain, relief, fonts
                   │                                         │
                   ▼                                         ▼
        BACKEND (Java): repositories → domain → API ──►  FRONTEND
```

The pipeline is **not** a running service. It runs when a new date is needed, a data error is
fixed, or a new timetable year starts. Every run produces a **new version**; published versions
never change.

**What goes where**

- **Database:** anything about trips, times, stations, lines and the paths vehicles follow, i.e.
  anything the backend must reason about.
- **Frontend files:** the map background, the same every day: street tiles, 3D terrain, relief, fonts.

---

## 3. Data sources

| # | Source | Where | Size | Used for | Licence / attribution |
|---|---|---|---|---|---|
| 1 | **GTFS timetable** (Switzerland, 2026) | `https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020/permalink` | 290 MB zip, 4.3 GB unzipped | Database | opentransportdata.swiss terms of use; cite the source |
| 2 | **OpenStreetMap**, Switzerland extract | `https://download.geofabrik.de/europe/switzerland-latest.osm.pbf` | 523 MB | Database **and** map tiles | ODbL: "© OpenStreetMap contributors" visible; share-alike for derived databases |
| 3 | **Copernicus GLO-90 DEM** (90 m heights) | `https://copernicus-dem-90m.s3.amazonaws.com/` | 18 tiles cover Switzerland | Database **and** terrain/relief | Copernicus DEM licence attribution |
| 4 | **Planetiler extras** (Natural Earth, water polygons, lake centrelines) | downloaded automatically by Planetiler | about 1.4 GB | Map tiles only | Natural Earth (public domain), OSM |
| 5 | **OpenMapTiles fonts** (Noto Sans) | `https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip` | 59 MB | Map labels only | font licence (OFL) |

**Important facts**

- The GTFS feed covers **14 Dec 2025 – 12 Dec 2026**. A date after that has no trips: a new feed
  is needed for the next timetable year.
- The GTFS feed is updated regularly; the one used so far has `feed_version = 20261017`.
- The OSM URL always gives the *latest* extract, so builds are not reproducible unless you keep
  the downloaded file and record its date. The one used so far was downloaded on 19 Oct 2026.
- The DEM cache (`data/cache/dem`) currently holds 599 tiles (1.5 GB); only the 18 covering
  latitude 45–47°N and longitude 5–10°E are needed.

---

## 4. Deliverables

| Deliverable | Format | Consumer | Versioned as |
|---|---|---|---|
| **Transport database** | PostgreSQL 17 Docker image on GitHub Container Registry | Backend | `smb-data:<dates>-v<n>`, e.g. `smb-data:2026-10-21-v1` |
| **Schema** | `contract/schema.sql` in the repo | Backend (the contract) | Git |
| **Map files** | One zip in a GitHub Release | Frontend | `map-<osm date>-v<n>` |

### Map files (straight to the frontend, never through the backend)

| File | Built from | Size | Built by |
|---|---|---|---|
| `tiles/switzerland.pmtiles` | OSM + Planetiler extras | 333 MB | `make tiles` (Planetiler, Java) |
| `terrain/switzerland-terrain.pmtiles` | Copernicus | 77 MB | `make terrain` |
| `relief.png` + `relief.json` | Copernicus + OSM border | 8 MB | `make relief` |
| `fonts/` | OpenMapTiles fonts | 3 MB | `make fonts` |
| `overview-tiles/` | Cut from the street tiles | 15 MB | `make overview` |

The frontend unzips these into `web/public/data/`. The map reads only the parts of the 333 MB
file it needs (HTTP range requests), which the Vite dev server supports. Never commit them to Git.

---

## 5. The database schema (the contract)

### Conventions

| Topic | Rule |
|---|---|
| Time | `*_s` columns are **seconds from the start of the service day** (09:32 = 34,320). Values may exceed 86,400: a train at 25:10 belongs to that day's timetable. Never wrap at midnight. |
| Dates | `service_date` is the timetable day the trip belongs to. |
| Coordinates | WGS84. `points` is `[[longitude, latitude, height_m], ...]`: **longitude first**. |
| Units | Metres for lengths and heights. |
| IDs | Valid within one release only; GTFS IDs can change between feed versions. |
| Direction | A path is stored once per station pair (`from_station_id < to_station_id`). `next_reversed = true` means the trip travels it backwards. |
| Ownership | Everything lives in schema `transport`. The backend gets read-only access. |

### Tables

```
Line ──< Trip ──< StopEvent >── Station
                     │
                     └── next_segment ──> PathSegment ──< SegmentTunnel >── Tunnel
```

### `contract/schema.sql`

This version loaded the full 21 Oct data with every constraint on.

```sql
CREATE SCHEMA transport;

-- Which sources this release was built from.
CREATE TABLE transport.dataset_release (
    version      TEXT PRIMARY KEY,        -- e.g. 2026-10-21-v1
    gtfs_version TEXT NOT NULL,           -- feed_info.feed_version, e.g. 20261017
    osm_version  TEXT NOT NULL,           -- e.g. geofabrik-2026-10-19
    built_at     TIMESTAMPTZ NOT NULL
);

-- A place where you can board (platforms are grouped into their station).
CREATE TABLE transport.stations (
    station_id  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    elevation_m REAL NOT NULL,
    country     CHAR(2) NOT NULL          -- ISO code, e.g. CH, DE, FR, IT, AT
);

-- A named service, e.g. IC1 or S6. One GTFS route; one name can have several line_ids.
CREATE TABLE transport.lines (
    line_id      TEXT PRIMARY KEY,
    name         TEXT NOT NULL,           -- e.g. IC1, S6
    category     TEXT NOT NULL,           -- e.g. IC, IR, S, B, T
    vehicle_type TEXT NOT NULL CHECK (vehicle_type IN
        ('TRAIN', 'BOAT', 'FUNICULAR', 'CABLE_CAR', 'ELEVATOR', 'TRAM', 'BUS')),
    operator     TEXT NOT NULL
);

-- The real path between two stations, shared by every trip that uses it.
CREATE TABLE transport.path_segments (
    segment_id      INTEGER PRIMARY KEY,
    from_station_id TEXT NOT NULL REFERENCES transport.stations,
    to_station_id   TEXT NOT NULL REFERENCES transport.stations,
    network         TEXT NOT NULL CHECK (network IN ('TRACK', 'FERRY', 'ROPE')),
    length_m        INTEGER NOT NULL CHECK (length_m >= 0),
    points          JSONB NOT NULL,       -- [[lon, lat, height_m], ...] from -> to
    is_estimated    BOOLEAN NOT NULL,     -- true = straight line, not found in OSM
    ropeway         TEXT,                 -- cable_car, gondola, chair_lift; NULL if not a rope
    UNIQUE (from_station_id, to_station_id, network)
);

CREATE TABLE transport.tunnels (
    tunnel_id INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,              -- OSM name, or 'Tunnel near <station>'
    length_m  INTEGER NOT NULL
);

-- Which part of a path runs inside which tunnel, as fractions of its length (0..1).
CREATE TABLE transport.segment_tunnels (
    segment_id     INTEGER NOT NULL REFERENCES transport.path_segments,
    tunnel_id      INTEGER NOT NULL REFERENCES transport.tunnels,
    start_fraction REAL NOT NULL,
    end_fraction   REAL NOT NULL
);

-- One run of a line on one date.
CREATE TABLE transport.trips (
    trip_id           TEXT PRIMARY KEY,   -- <yyyymmdd>:<gtfs trip_id>[@<start s>]
    line_id           TEXT NOT NULL REFERENCES transport.lines,
    service_date      DATE NOT NULL,
    headsign          TEXT NOT NULL,      -- destination shown to passengers
    trip_number       TEXT,               -- e.g. 712
    first_departure_s INTEGER NOT NULL,
    last_arrival_s    INTEGER NOT NULL,
    is_generated      BOOLEAN NOT NULL,   -- expanded from frequencies.txt, not a real timetable entry
    CHECK (first_departure_s <= last_arrival_s)
);

-- One trip at one station.
CREATE TABLE transport.stop_events (
    trip_id         TEXT NOT NULL REFERENCES transport.trips,
    sequence        INTEGER NOT NULL,     -- GTFS order; may have gaps
    station_id      TEXT NOT NULL REFERENCES transport.stations,
    platform        TEXT,
    arrival_s       INTEGER NOT NULL,
    departure_s     INTEGER NOT NULL,
    next_segment_id INTEGER REFERENCES transport.path_segments,  -- NULL: last stop, no path, bus/tram
    next_reversed   BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (trip_id, sequence),
    CHECK (arrival_s <= departure_s)
);

CREATE INDEX trips_running_idx
    ON transport.trips (service_date, first_departure_s, last_arrival_s);
CREATE INDEX stop_events_station_idx
    ON transport.stop_events (station_id, departure_s);

-- Read-only user for the backend.
CREATE ROLE backend_reader LOGIN PASSWORD 'dev';
GRANT USAGE ON SCHEMA transport TO backend_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA transport TO backend_reader;
```

Planned additions (they add tables and never change existing ones): `lead_ins` (track behind a
waiting train, so trains stay whole at their first station) and `pylons` (cable car pylons).
Both are already computed by the current pipeline for the 3D frontend.

---

## 6. What comes from each source

### GTFS: the "when" and "who"

| GTFS file | Fields used | Becomes |
|---|---|---|
| `stops.txt` | `stop_id`, `stop_name`, `stop_lat`, `stop_lon` | `stations` ID, name, location |
| | `parent_station` | Groups platforms into one station |
| | `platform_code` | `stop_events.platform` |
| | `didok` (first 2 digits) | `stations.country` |
| `routes.txt` | `route_id`, `route_short_name`, `route_desc` | `lines` ID, name, category |
| | `route_type` | `lines.vehicle_type` |
| `agency.txt` | `agency_id`, `agency_name` | `lines.operator` |
| `trips.txt` | `trip_id`, `route_id`, `trip_headsign`, `trip_short_name` | `trips` |
| | `service_id` | Only to choose the date's trips |
| `calendar.txt`, `calendar_dates.txt` | all | Only to choose the date's trips (not stored) |
| `frequencies.txt` | `trip_id`, `start_time`, `end_time`, `headway_secs` | One trip per departure, `is_generated = true` |
| `stop_times.txt` | `trip_id`, `stop_id`, `stop_sequence`, `arrival_time`, `departure_time` | `stop_events` |
| `feed_info.txt` | `feed_version` | `dataset_release.gtfs_version` |

**Not used:** `transfers.txt`, `pickup_type`, `drop_off_type`, `block_id`, `direction_id`,
`original_trip_id`, `hints`, agency phone and website.

### OpenStreetMap: the "where"

OSM is not copied into the database. The pipeline builds networks from these tags, routes over
them, and stores the resulting paths.

| OSM tag | Becomes |
|---|---|
| `railway` = `rail`, `light_rail`, `narrow_gauge`, `funicular` | `path_segments` with `network = TRACK` |
| `route=ferry` | `path_segments` with `network = FERRY` |
| `aerialway` = `cable_car`, `gondola`, `mixed_lift`, `chair_lift` | `path_segments` with `network = ROPE`, plus `ropeway` |
| `tunnel=yes` with `tunnel:name` or `name` | `tunnels`, `segment_tunnels` |
| `bridge=*` | Not stored; keeps track level across valleys in the heights |
| node coordinates | longitude and latitude in `points` |
| *later:* `aerialway=pylon` | `pylons` |

Streets, buildings, land use and place names go only into the map tiles.

### Copernicus: the "how high"

| Height looked up at | Becomes |
|---|---|
| each station | `stations.elevation_m` |
| each point of a path | the height in each `points` entry |

### Calculated by the pipeline

| Column | How |
|---|---|
| `segment_id` | A number per unique (station pair, network) |
| `length_m` | Measured along the routed path |
| `is_estimated` | True when OSM routing found nothing and a straight line was used |
| `trip_id` | Date + GTFS ID (+ `@start` for generated trips) |
| `first_departure_s`, `last_arrival_s` | First and last stop time of the trip |
| `next_segment_id`, `next_reversed` | Which stored path leads to the next stop, in which direction |
| tunnel fractions | Where a tunnel starts and ends along a path |
| `version`, `built_at` | Set when the release is built |

---

## 7. Data rules

### Vehicle type from GTFS `route_type`

| `route_type` | `vehicle_type` | Examples (`route_desc`) |
|---|---|---|
| 100–199 | `TRAIN` | IC, IR, EC, TGV, S, R, RE, PE, CC, NJ |
| 1000–1099 | `BOAT` | BAT, FAE |
| 1303 | `ELEVATOR` | ASC (e.g. Bern Matte lift, Hammetschwand) |
| 1300–1399 (other) | `CABLE_CAR` | PB, GB, SL |
| 1400–1499 | `FUNICULAR` | FUN |
| 900–999, 400–499 | `TRAM` | T, M (Lausanne metro) |
| 700–799, 200–299 | `BUS` | B, EV, RUB, EXB, CAR |
| anything else | excluded | e.g. 1500 taxi |

The current `pipeline/src/smb_pipeline/modes.py` puts elevators (1303) in with cable cars. That
is wrong and must change.

### Country from the first two digits of `didok`

| Prefix | Country | Prefix | Country |
|---|---|---|---|
| 85 | CH | 13, 83 | IT |
| 11, 80 | DE | 14, 87 | FR |
| 12, 81 | AT | 82 / 88 / 84 / 71 / 54 | LU / BE / NL / ES / CZ |

### Other rules

| Topic | Rule |
|---|---|
| Area | Stations inside the LV95 box E 2,480,000–2,840,000, N 1,070,000–1,300,000 are kept. This includes border areas in neighbouring countries, so `country` labels them. Stops outside the box are dropped from a trip, so `sequence` can have gaps. |
| Short trips | A trip with fewer than 2 stops left after that is dropped (188 on 21 Oct). |
| Frequencies | A "runs every N seconds" row becomes one trip per departure, with `is_generated = true`. 58,258 of 67,594 cable car trips are generated. |
| Midnight | Keep GTFS times as they are; never wrap at 24:00. |
| Paths | One path per (station pair, network), shared by all vehicle types and directions. Vehicle types that share a pair use the same route (checked: 220 shared pairs, identical routes). |
| Missing paths | Buses and trams have no paths yet (`next_segment_id = NULL`). Pairs that cannot be routed on OSM get a straight line (`is_estimated = true`). Pairs involving a station beyond the OSM extract get no path. |
| Multiple dates | Build **all dates of a release in one run**, so stations, lines and paths are shared with stable IDs. Never append a date to an existing release. |

---

## 8. The pipeline

### Stages and existing code to reuse

| Stage | What it does | Existing code (`pipeline/src/smb_pipeline/`) |
|---|---|---|
| 1 Extract | Download sources, record versions | `Makefile` targets `gtfs`, `osm` (need version pinning) |
| 2a Select dates | Load GTFS in DuckDB; active trips; expand frequencies | `feed.py`: `register_feed`, `materialize_service_day` |
| 2b Stations | Group platforms; keep the area | `stations.py`: `materialize_parents`, `StationLocator` |
| 2c Classify | `route_type` to vehicle type | `modes.py` (fix elevators) |
| 2d Route | Build OSM networks; find the path for each station pair | `osm.py` `read_osm`; `network.py` `build_network`; `routing.py` `NetworkRouter` (snap radius 300 m, ferries 800 m); `motion.py` `leg_rows`, `route_unique_pairs` |
| 2e Heights | Heights along paths and at stations | `dem.py` `CopernicusDem`, `SmoothedDem`, `DemElevation`; `heights.py` `HeightProfiler` |
| 3 Load | Export tables, load into PostgreSQL | **new** (prototype: `~/smb-trial-db/export_trial.py`, `load.sql`) |
| 4 Validate | Automatic checks (section 9) | **new** |
| 5 Publish | `pg_dump`, Docker image, push | **new** (section 10) |
| Map files | Tiles, terrain, relief, fonts | `make tiles`, `make terrain`, `make relief`, `make fonts`, `make overview` |

**To retire** once the frontend reads from the backend: the music JSON files built by
`build.py`/`contract.py` (`Day`, `Motion`), `explore.py`, and the unused `OpenMeteoElevation` in
`elevation.py`.

**Prototype quirks to fix:** `StationLocator` needs `events.materialize_departures` to have run
first; the prototype imports private functions (`_segment`, `_bind`); DuckDB's `COPY ... TO`
writes a header row, so load those CSVs with `CSV HEADER`.

### Target command

```sh
make release DATES=2026-10-21,2026-10-24,2026-10-25 VERSION=v1
```

One command, one run, all dates, ending with a pushed image, or a failure if any check fails.
On the prototype machine one date took about 40 s to export and 40 s to load.

### Recommended dates

Store **a few chosen days**, each fully expanded: a weekday, a Saturday and a Sunday.

| Option | Size | Verdict |
|---|---|---|
| A few chosen days | about 760 MB per day in PostgreSQL | **Recommended**: simple, matches the project |
| Every day of the year | roughly 280 GB | Too big |
| Weekly patterns + calendar | roughly 10 GB (estimated) | Moves calendar rules into the Java domain; too complex for this project |

---

## 9. Validation

Run these after every load. Constraints in the schema already catch broken references,
duplicate keys and `arrival > departure`. The checks below catch the rest. Baseline numbers are
from the 21 Oct prototype; large changes need an explanation before publishing.

| Check | Expected (21 Oct) |
|---|---|
| Trips by type | BUS 146,503 · CABLE_CAR 67,594 · TRAIN 16,176 · TRAM 13,120 · FUNICULAR 7,511 · ELEVATOR 2,762 · BOAT 922 (254,588 total) |
| Stop events | 3,069,646 |
| Stations by country | CH 23,963 · DE 2,958 · AT 1,694 · FR 949 · IT 89 (29,653 total) |
| Paths | 2,538 (estimated: 55 track, 4 ferry, 7 rope) |
| Train legs without a path | 7,101, of which 6,744 touch a foreign station |
| Time never goes backwards within a trip | 0 violations |
| Running at 08:00 | 5,234 vehicles |
| Paths start near `from_station` | 6 exceptions, all shorter than 600 m |
| Train speeds | Nothing over 260 km/h; median 47 km/h |
| Stop events after 24:00 | 44,750 in 3,602 trips; latest 122,700 s (34:05, night trains) |

```sql
SET search_path = transport;

-- Trips by vehicle type
SELECT l.vehicle_type, count(*) trips, count(*) FILTER (WHERE is_generated) generated
  FROM trips t JOIN lines l USING (line_id) GROUP BY 1 ORDER BY 2 DESC;

-- Time goes backwards inside a trip (must be 0)
SELECT count(*) FROM (
  SELECT departure_s, lead(arrival_s) OVER (PARTITION BY trip_id ORDER BY sequence) next_arrival
    FROM stop_events) x
 WHERE next_arrival < departure_s;

-- Every trip has at least 2 stops (must be 0)
SELECT count(*) FROM trips t
 WHERE (SELECT count(*) FROM stop_events e WHERE e.trip_id = t.trip_id) < 2;

-- Running at 08:00
SELECT l.vehicle_type, count(*) FROM trips t JOIN lines l USING (line_id)
 WHERE service_date = '2026-10-21' AND first_departure_s <= 28800 AND last_arrival_s >= 28800
 GROUP BY 1 ORDER BY 2 DESC;

-- Sanity: departure board, Zürich HB 08:00-08:10
SELECT to_char(make_interval(secs => e.departure_s), 'HH24:MI') dep, l.name, t.headsign, e.platform
  FROM stop_events e JOIN stations s USING (station_id) JOIN trips t USING (trip_id)
  JOIN lines l USING (line_id)
 WHERE s.name = 'Zürich HB' AND e.departure_s BETWEEN 28800 AND 29400
   AND e.next_segment_id IS NOT NULL
 ORDER BY 1;

-- Release row is filled (must be 1)
SELECT count(*) FROM dataset_release;
```

Spot check by hand: IC 712 on 21 Oct runs St. Gallen 08:07 → Genève-Aéroport 12:37 in 15
stops; Zürich HB → Bern is 116.9 km.

---

## 10. Publishing

### Database image

```sh
# 1. Record the release
docker exec smb-db psql -U postgres -d transport -c \
  "INSERT INTO transport.dataset_release VALUES ('2026-10-21-v1', '20261017', 'geofabrik-2026-10-19', now());"

# 2. Dump
mkdir -p ~/smb-db-image && cd ~/smb-db-image
docker exec smb-db pg_dump -U postgres transport | gzip > 10-data.sql.gz
```

`20-backend-role.sql` (runs after the data is restored):

```sql
CREATE ROLE backend_reader LOGIN PASSWORD 'dev';
GRANT USAGE ON SCHEMA transport TO backend_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA transport TO backend_reader;
```

`Dockerfile`:

```dockerfile
FROM postgres:17
COPY 10-data.sql.gz 20-backend-role.sql /docker-entrypoint-initdb.d/
```

```sh
# 3. Log in (once) and push for Mac and Intel/Windows
gh auth refresh -h github.com -s write:packages
gh auth token | docker login ghcr.io -u VitorBertoldi --password-stdin
docker buildx create --name smb-builder --use
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/vitorbertoldi/smb-data:2026-10-21-v1 --push .
```

Keep the package private (OSM's ODbL share-alike applies to a public derived database) and give
teammates **Read** access in the package settings.

Prototype measurements: database 760 MB, dump 39 MB, image 742 MB, first start restores in about
10 s. The multi-platform push has not been tested yet.

### How the other groups use it

`compose.yaml` in the repo root:

```yaml
services:
  transport-db:
    image: ghcr.io/vitorbertoldi/smb-data:2026-10-21-v1
    environment:
      POSTGRES_DB: transport
      POSTGRES_PASSWORD: dev
    ports:
      - "5433:5432"
    volumes:
      - transport-data:/var/lib/postgresql/data

volumes:
  transport-data:
```

| Setting | Value |
|---|---|
| Host and port | `localhost:5433` (not 5432) |
| Database | `transport` (tables are in schema `transport`, not `public`) |
| Backend user | `backend_reader` / `dev` |
| Admin user | `postgres` / `dev` |
| JDBC URL | `jdbc:postgresql://localhost:5433/transport` |

### Versioning

1. Never overwrite a tag. Publish `...-v2`.
2. Update the tag in `compose.yaml` and commit it.
3. Everyone runs `docker compose down -v && docker compose up -d`. The `-v` is required: without
   it PostgreSQL keeps the old data and does not restore the new image.

---

## 11. Known data issues and limits

| # | Issue | Impact | Next step |
|---|---|---|---|
| 1 | Most cable car trips are generated from "every N seconds" rules (`exact_times = 0`) | 58,258 of 67,594 cable car trips are not real timetable entries | Keep `is_generated`; backend decides how to show them |
| 2 | Elevators were classed as cable cars | 2,762 trips; their paths are straight lines of 0–13 m | Fixed in the new mapping; decide whether elevators get a path at all |
| 3 | The area is a box, not the border | About 12% of bus stop visits and some stations are in neighbouring countries | Keep with `country`, or filter by the OSM border |
| 4 | Stations snap to the nearest track up to 300 m away | Very short hops can be too short (Reinach AG Mitte → Nord: 74 m) | Investigate snapping for short legs |
| 5 | GTFS times are whole minutes | 278,515 legs take 0 s (mostly bus and tram); some hops look slow | Document; backend must handle 0-s legs |
| 6 | One path per station pair | Two different real routes between the same stations would share one | No case found yet; keep the speed check |
| 7 | Buses and trams have no paths | They can't move on the map yet | Route them on OSM streets later |
| 8 | Terrain is a 90 m surface model (includes buildings and forest) | Track heights in towns are a few metres high | swisstopo swissALTI3D (2 m) later |
| 9 | Builds aren't reproducible | OSM "latest", no version pinning | Keep raw files per release; record versions |
| 10 | The feed ends 12 Dec 2026 | No trips after that date | Plan the 2027 feed |

---

## 12. Getting started

**Setup:** `uv`, Node ≥ 22, Java 25 (Planetiler), Docker, `make`. Then `make setup` and
`make gtfs osm` (about 1 GB of downloads).

**Reproduce the prototype database** (about 2 minutes once the data is downloaded):

```sh
cd ~/smb-trial-db
~/Documents/USI/design-101/swiss-music-box/pipeline/.venv/bin/python -I export_trial.py \
  ~/Documents/USI/design-101/swiss-music-box "$PWD"

docker run -d --name smb-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=transport \
  -p 5433:5432 -v smb-db-data:/var/lib/postgresql/data postgres:17
until docker exec smb-db pg_isready -h 127.0.0.1 -U postgres -d transport; do sleep 1; done

docker exec smb-db mkdir -p /trial
for f in schema.sql load.sql *.csv; do docker cp "$f" smb-db:/trial/"$f"; done
docker exec smb-db psql -U postgres -d transport -q -f /trial/load.sql
```

To browse it: DBeaver, host `localhost`, port `5433`, database `transport`, user `postgres`,
password `dev`; tables are under Schemas → `transport`.

### First tasks

1. **Agree the contract with the domain group**: put `schema.sql` in `contract/` and settle the
   open questions below.
2. **Pin the sources**: keep the downloaded files per release and record their versions.
3. **Move the prototype into the pipeline**: a `release` step in `pipeline/` with a list of
   dates, using public functions instead of private ones, with tests.
4. **Fix the classification**: elevators, and the country rule.
5. **Automate validation**: section 9 as checks that stop the build.
6. **Automate publishing**: `make release` from download to pushed image.
7. **Publish the map files** as a GitHub Release.
8. **Add the remaining tables** when the frontend needs them: `lead_ins`, `pylons`.

### Open questions to agree with the domain group

| Question | Suggested answer |
|---|---|
| Which dates? | One weekday, one Saturday, one Sunday |
| Keep foreign stations? | Yes, labelled with `country` |
| Time convention | Seconds from the start of the service day, never wrapped |
| Do elevators get paths? | No path (`next_segment_id = NULL`) until there is a reason |
| When to add `lead_ins` and `pylons`? | When the frontend needs whole trains and pylons |
| How to identify a line to users? | `name` + `category` + `trip_number`; one name can have several `line_id`s |
