import type { Motion, Segment } from "../contract/motion";
import { at } from "../music/collections";
import { MINUTES_PER_DAY } from "../music/constants";
import { distanceM, type LonLat, toLonLats } from "./lonLat";
import type { MovingLayer } from "./palette";

/**
 * One vehicle's whole day: a path with a timestamp (timetable minute) per vertex.
 * Stored as flat typed arrays because a day has ~1.8 million vertices.
 */
export interface VehicleTrack {
	readonly layer: MovingLayer;
	/** Interleaved [longitude0, latitude0, longitude1, ...] (overview geometry). */
	readonly positions: Float32Array;
	readonly timestamps: Float32Array;
	/** Per vertex: 1 if the stretch starting at this vertex runs inside a tunnel. */
	readonly insideTunnel: Uint8Array;
}

export interface VehicleTracks {
	readonly all: readonly VehicleTrack[];
	/** Tracks that continue past 24:00; drawn a second time, shifted back by one day. */
	readonly pastMidnight: readonly VehicleTrack[];
	readonly vertexCount: number;
}

/** A segment's vertices in one direction of travel, tunnel entries and exits included. */
export interface DirectedVertices {
	readonly xs: readonly number[];
	readonly ys: readonly number[];
	/** Share of the segment travelled when reaching each vertex, 0..1. */
	readonly fractions: readonly number[];
	readonly insideTunnel: readonly boolean[];
}

interface PreparedSegment {
	readonly forward: DirectedVertices;
	readonly backward: DirectedVertices;
}

/**
 * Builds `VehicleTrack`s for the country-wide long-exposure view, from the 15 m overview
 * geometry (precise views use `VehicleTimeline` instead). Each segment is prepared once (both
 * directions, with extra vertices where it enters and leaves tunnels); each leg then spreads
 * its travel time over the segment's vertices by distance.
 */
export class VehicleTrackBuilder {
	private readonly segments: readonly PreparedSegment[];

	constructor(private readonly motion: Motion) {
		this.segments = motion.segments.map(prepareSegment);
	}

	build(): VehicleTracks {
		const { layer, first_leg, leg_count } = this.motion.trips;
		const all: VehicleTrack[] = [];
		let vertexCount = 0;
		for (let trip = 0; trip < layer.length; trip++) {
			const track = this.trackOf(at(layer, trip), at(first_leg, trip), at(leg_count, trip));
			all.push(track);
			vertexCount += track.timestamps.length;
		}
		const pastMidnight = all.filter((track) => (track.timestamps.at(-1) ?? 0) > MINUTES_PER_DAY);
		return { all, pastMidnight, vertexCount };
	}

	private trackOf(layer: MovingLayer, firstLeg: number, legCount: number): VehicleTrack {
		const legs = this.motion.legs;
		const directed = (leg: number): DirectedVertices => {
			const segment = at(this.segments, at(legs.segment, leg));
			return at(legs.reversed, leg) ? segment.backward : segment.forward;
		};
		let size = 0;
		for (let leg = firstLeg; leg < firstLeg + legCount; leg++) size += directed(leg).xs.length;

		const positions = new Float32Array(size * 2);
		const timestamps = new Float32Array(size);
		const insideTunnel = new Uint8Array(size);
		let vertex = 0;
		let previousArrival = 0;
		for (let leg = firstLeg; leg < firstLeg + legCount; leg++) {
			const vertices = directed(leg);
			// Timestamps must never go back in time, even if the timetable has a glitch.
			const departure = Math.max(at(legs.depart_minute, leg), previousArrival);
			const arrival = Math.max(at(legs.arrive_minute, leg), departure);
			for (let i = 0; i < vertices.xs.length; i++, vertex++) {
				positions[vertex * 2] = at(vertices.xs, i);
				positions[vertex * 2 + 1] = at(vertices.ys, i);
				timestamps[vertex] = departure + at(vertices.fractions, i) * (arrival - departure);
				insideTunnel[vertex] = at(vertices.insideTunnel, i) ? 1 : 0;
			}
			previousArrival = arrival;
		}
		return { layer, positions, timestamps, insideTunnel };
	}
}

export function prepareSegment(segment: Segment): PreparedSegment {
	const forward = forwardVertices(segment);
	return { forward, backward: reversedVertices(forward) };
}

function forwardVertices(segment: Segment): DirectedVertices {
	const points = toLonLats(segment.overview_coordinates);
	const pointFractions = cumulativeFractions(points);
	const spans = segment.tunnels.map((passage) => [passage.start_fraction, passage.end_fraction] as const);
	const fractions = [...new Set([...pointFractions, ...spans.flat()])].sort((a, b) => a - b);

	const xs: number[] = [];
	const ys: number[] = [];
	let pointIndex = 1;
	for (const fraction of fractions) {
		while (pointIndex < points.length - 1 && at(pointFractions, pointIndex) < fraction) pointIndex++;
		const [startLongitude, startLatitude] = at(points, pointIndex - 1);
		const [endLongitude, endLatitude] = at(points, pointIndex);
		const f0 = at(pointFractions, pointIndex - 1);
		const f1 = at(pointFractions, pointIndex);
		const t = f1 === f0 ? 0 : Math.min(1, Math.max(0, (fraction - f0) / (f1 - f0)));
		xs.push(startLongitude + t * (endLongitude - startLongitude));
		ys.push(startLatitude + t * (endLatitude - startLatitude));
	}
	return {
		xs,
		ys,
		fractions,
		insideTunnel: fractions.map((fraction) => spans.some(([start, end]) => start <= fraction && fraction < end)),
	};
}

/**
 * The same vertices travelled the other way. A vertex's tunnel flag describes the stretch
 * after it, which going backwards is the stretch that came before it going forwards.
 */
export function reversedVertices(forward: DirectedVertices): DirectedVertices {
	const count = forward.xs.length;
	const reversedIndex = (i: number): number => count - 1 - i;
	const indices = Array.from({ length: count }, (_, i) => reversedIndex(i));
	return {
		xs: indices.map((i) => at(forward.xs, i)),
		ys: indices.map((i) => at(forward.ys, i)),
		fractions: indices.map((i) => 1 - at(forward.fractions, i)),
		insideTunnel: indices.map((i) => (i > 0 ? at(forward.insideTunnel, i - 1) : false)),
	};
}

function cumulativeFractions(points: readonly LonLat[]): number[] {
	const distances = [0];
	for (let i = 1; i < points.length; i++)
		distances.push(at(distances, i - 1) + distanceM(at(points, i - 1), at(points, i)));
	const total = distances.at(-1) ?? 0;
	return distances.map((distance) => (total === 0 ? 0 : distance / total));
}
