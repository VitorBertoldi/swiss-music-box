import type { Layer } from "@deck.gl/core";
import { TripsLayer } from "@deck.gl/geo-layers";
import { MINUTES_PER_DAY } from "../music/constants";
import type { PackedTracks } from "./packedPaths";

/** How vehicles are drawn; each scene picks its own style. */
export interface VehicleStyle {
	/** Length of the fading trail behind each vehicle, in timetable minutes. */
	readonly trailMinutes: number;
	readonly widthPx: number;
	readonly opacity: number;
	/** Add light instead of painting over: overlapping trails glow brighter. */
	readonly additive: boolean;
}

export interface VehicleBuffers {
	readonly day: PackedTracks;
	readonly dayColours: Uint8Array;
	readonly pastMidnight: PackedTracks;
	readonly pastMidnightColours: Uint8Array;
}

const ADDITIVE_BLENDING = {
	blend: true,
	blendColorSrcFactor: "src-alpha",
	blendColorDstFactor: "one",
	blendAlphaSrcFactor: "one",
	blendAlphaDstFactor: "one",
	depthWriteEnabled: false,
} as const;

/**
 * Two layers: the day itself, and the part of late trips running after 24:00, replayed at
 * the start of the day so the small hours aren't empty.
 */
export function vehicleLayers(buffers: VehicleBuffers, minute: number, style: VehicleStyle, idPrefix: string): Layer[] {
	return [
		tripsLayer(`${idPrefix}-vehicles`, buffers.day, buffers.dayColours, minute, style),
		tripsLayer(
			`${idPrefix}-vehicles-after-midnight`,
			buffers.pastMidnight,
			buffers.pastMidnightColours,
			minute + MINUTES_PER_DAY,
			style,
		),
	];
}

function tripsLayer(
	id: string,
	tracks: PackedTracks,
	colours: Uint8Array,
	currentTime: number,
	style: VehicleStyle,
): Layer {
	return new TripsLayer({
		id,
		data: {
			length: tracks.length,
			startIndices: tracks.startIndices,
			attributes: {
				getPath: { value: tracks.positions, size: 2 },
				getTimestamps: { value: tracks.timestamps, size: 1 },
				getColor: { value: colours, size: 4, normalized: true },
			},
		},
		_pathType: "open",
		positionFormat: "XY",
		currentTime,
		trailLength: style.trailMinutes,
		fadeTrail: true,
		getWidth: style.widthPx,
		widthUnits: "pixels",
		widthMinPixels: 1,
		capRounded: true,
		jointRounded: true,
		opacity: style.opacity,
		updateTriggers: { getColor: colours },
		...(style.additive ? { parameters: ADDITIVE_BLENDING } : {}),
	});
}
