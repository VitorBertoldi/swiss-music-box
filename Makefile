DATE ?= 2026-10-21
GTFS_URL := https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020/permalink
OSM_URL := https://download.geofabrik.de/europe/switzerland-latest.osm.pbf
GTFS_DIR := data/raw/gtfs_fp2026
OSM_FILE := data/raw/osm/switzerland-latest.osm.pbf
PUBLIC_DATA := web/public/data
PLANETILER_VERSION := 0.10.2
PLANETILER_JAR := tools/planetiler-$(PLANETILER_VERSION).jar
TILES_FILE := $(PUBLIC_DATA)/tiles/switzerland.pmtiles
FONTS_URL := https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip
FONTS_DIR := $(PUBLIC_DATA)/fonts

.PHONY: help setup gtfs osm data day relief tiles fonts overview contract dev build check check-pipeline check-web fix hooks smoke

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

setup: ## Install Python and Node dependencies
	cd pipeline && uv sync
	cd web && npm ci

gtfs: $(GTFS_DIR)/stop_times.txt ## Download the Swiss GTFS timetable (~290 MB zip, ~4.6 GB unzipped)

$(GTFS_DIR)/stop_times.txt:
	mkdir -p data/raw
	curl -L -A "Mozilla/5.0" -o data/raw/gtfs.zip "$(GTFS_URL)"
	unzip -o -q data/raw/gtfs.zip -d $(GTFS_DIR)

osm: $(OSM_FILE) ## Download the OpenStreetMap extract of Switzerland (~550 MB)

$(OSM_FILE):
	mkdir -p $(dir $(OSM_FILE))
	curl -L -o $(OSM_FILE) "$(OSM_URL)"

data: day relief tiles fonts ## Build everything the player needs for DATE (default 2026-10-21)

day: gtfs osm ## Day (sound) and motion files for DATE (~1 min)
	cd pipeline && uv run smb build --gtfs-dir ../$(GTFS_DIR) --osm ../$(OSM_FILE) --date $(DATE) --out-dir ../$(PUBLIC_DATA)

relief: osm ## Shaded relief cut to the OSM border; independent of the date (downloads DEM tiles once)
	cd pipeline && uv run smb relief --osm ../$(OSM_FILE) --out ../$(PUBLIC_DATA)/relief.json

tiles: $(TILES_FILE) ## Street-level vector tiles of Switzerland with Planetiler (~10 min; first run downloads ~1 GB)

$(TILES_FILE): $(OSM_FILE) | $(PLANETILER_JAR)
	mkdir -p $(dir $(TILES_FILE))
	java -Xmx3g -jar $(PLANETILER_JAR) --osm-path=$(OSM_FILE) --output=$(TILES_FILE) \
		--download --download_dir=data/cache/planetiler --tmpdir=data/cache/planetiler/tmp --force

$(PLANETILER_JAR):
	mkdir -p tools
	curl -L -o $@ "https://github.com/onthegomap/planetiler/releases/download/v$(PLANETILER_VERSION)/planetiler.jar"

fonts: $(FONTS_DIR)/Noto\ Sans\ Regular/0-255.pbf ## Label glyphs (Noto Sans), so the map needs no font server

$(FONTS_DIR)/Noto\ Sans\ Regular/0-255.pbf:
	mkdir -p data/cache $(FONTS_DIR)
	curl -L -o data/cache/noto-sans.zip "$(FONTS_URL)"
	cd pipeline && uv run smb fonts --zip ../data/cache/noto-sans.zip --out-dir ../$(FONTS_DIR)

overview: tiles ## Low-zoom tiles as plain files, for hosts without HTTP range requests (the shared link)
	cd pipeline && uv run smb overview-tiles --pmtiles ../$(TILES_FILE) --out-dir ../$(PUBLIC_DATA)/overview-tiles

contract: ## Regenerate JSON Schema and TypeScript types from the Pydantic models
	cd pipeline && uv run smb schema --out-dir ../contract
	cd web && npm run -s contract

dev: ## Run the player with hot reload
	cd web && npm run dev

build: ## Production build of the player (web/dist)
	cd web && npm run build

check: check-pipeline check-web ## Every lint, type check and test; what CI runs
	@git diff --exit-code contract web/src/contract || (echo "contract is stale: run 'make contract'" && exit 1)

check-pipeline:
	cd pipeline && uv run ruff check . && uv run ruff format --check . && uv run mypy src tests && uv run pytest -q

check-web:
	cd web && npm run -s lint && npm run -s typecheck && npm run -s test

fix: ## Auto-format and apply safe lint fixes
	cd pipeline && uv run ruff check --fix . && uv run ruff format .
	cd web && npm run -s format

hooks: ## Run `make check` before every commit
	git config core.hooksPath .githooks

smoke: ## Screenshots of every scene and street-level views at 1080p and 4K (headless Chrome)
	cd web && (npx vite --port 5173 --strictPort & echo $$! > /tmp/smb-dev.pid) && sleep 3 && \
	node scripts/smoke.mjs http://localhost:5173/ ../explorations/screens; status=$$?; kill $$(cat /tmp/smb-dev.pid); exit $$status
