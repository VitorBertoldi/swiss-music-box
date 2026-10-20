import type { Palette, Rgba } from "./palette";
import { withAlpha } from "./palette";
import type { VehicleTrack } from "./vehicles";

/**
 * Many paths in one set of buffers: deck.gl's binary data format.
 * Path i uses vertices `startIndices[i] .. startIndices[i + 1]`.
 */
export interface PackedPaths {
	readonly length: number;
	readonly startIndices: Uint32Array;
	readonly positions: Float32Array;
	readonly vertexCount: number;
}

export interface PackedTracks extends PackedPaths {
	readonly timestamps: Float32Array;
	readonly tracks: readonly VehicleTrack[];
}

export function packTracks(tracks: readonly VehicleTrack[]): PackedTracks {
	const vertexCount = tracks.reduce((sum, track) => sum + track.timestamps.length, 0);
	const startIndices = new Uint32Array(tracks.length);
	const positions = new Float32Array(vertexCount * 2);
	const timestamps = new Float32Array(vertexCount);
	let offset = 0;
	tracks.forEach((track, i) => {
		startIndices[i] = offset;
		positions.set(track.positions, offset * 2);
		timestamps.set(track.timestamps, offset);
		offset += track.timestamps.length;
	});
	return { length: tracks.length, startIndices, positions, timestamps, tracks, vertexCount };
}

/** RGBA per vertex: the vehicle's colour, faded while it runs inside a tunnel. */
export function trackColours(packed: PackedTracks, palette: Palette): Uint8Array {
	const colours = new Uint8Array(packed.vertexCount * 4);
	let vertex = 0;
	for (const track of packed.tracks) {
		const open = palette.vehicles[track.layer];
		const hidden = withAlpha(open, palette.insideTunnelAlpha);
		for (let i = 0; i < track.insideTunnel.length; i++, vertex++) {
			colours.set(track.insideTunnel[i] ? hidden : (open as Rgba), vertex * 4);
		}
	}
	return colours;
}
