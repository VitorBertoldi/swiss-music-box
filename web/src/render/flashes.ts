import type { Layer } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Station } from "../contract/day";
import type { OverlayProps } from "../map/overlayProps";
import { at } from "../music/collections";
import type { NoteLayer, ScoredNote } from "../music/types";
import type { LonLat } from "./lonLat";
import type { Palette } from "./palette";

const FLASH_LIFETIME_MS = 1100;
const FLASH_START_RADIUS_PX = 3;
const FLASH_GROWTH_PX = 18;
/** Enough for several seconds at the note budget; older flashes are long gone anyway. */
const MAX_FLASHES = 600;

interface Flash {
	readonly position: LonLat;
	readonly layer: NoteLayer;
	readonly atMs: number;
}

/** Rings that pulse out from a station each time it plays a note. */
export class StationFlashes {
	private readonly stationPositions: readonly LonLat[];
	private flashes: Flash[] = [];

	constructor(stations: readonly Station[]) {
		this.stationPositions = stations.map((station): LonLat => [station.longitude, station.latitude]);
	}

	add(note: ScoredNote, atMs: number): void {
		this.flashes.push({ position: at(this.stationPositions, note.station), layer: note.layer, atMs });
		if (this.flashes.length > MAX_FLASHES) this.flashes.splice(0, this.flashes.length - MAX_FLASHES);
	}

	clear(): void {
		this.flashes = [];
	}

	layer(nowMs: number, palette: Palette, opacity: number, idPrefix: string, beneathLabels: string): Layer {
		this.flashes = this.flashes.filter((flash) => nowMs - flash.atMs < FLASH_LIFETIME_MS);
		// Notes are scheduled slightly ahead; show only those already heard.
		const visible = this.flashes.filter((flash) => flash.atMs <= nowMs);
		const age = (flash: Flash): number => (nowMs - flash.atMs) / FLASH_LIFETIME_MS;
		return new ScatterplotLayer<Flash, OverlayProps>({
			id: `${idPrefix}-flashes`,
			data: visible,
			getPosition: (flash) => flash.position as LonLat,
			getRadius: (flash) => FLASH_START_RADIUS_PX + FLASH_GROWTH_PX * age(flash),
			radiusUnits: "pixels",
			stroked: true,
			filled: true,
			lineWidthUnits: "pixels",
			getLineWidth: 1.2,
			getLineColor: (flash) => {
				const [red, green, blue] = palette.vehicles[flash.layer];
				return [red, green, blue, Math.round(255 * (1 - age(flash)))];
			},
			getFillColor: (flash) => {
				const [red, green, blue] = palette.vehicles[flash.layer];
				return [red, green, blue, Math.round(120 * (1 - age(flash)) ** 2)];
			},
			opacity,
			updateTriggers: { getRadius: nowMs, getLineColor: nowMs, getFillColor: nowMs },
			beforeId: beneathLabels,
		});
	}
}
