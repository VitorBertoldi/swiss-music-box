import type { Motion, Segment } from "../contract/motion";
import { at } from "../music/collections";
import { MINUTES_PER_DAY } from "../music/constants";
import { distanceM, type LonLat, lerpLonLat, toLonLats } from "./lonLat";
import type { MovingLayer } from "./palette";
import type { PathMeasure } from "./pathMeasure";
import { TripRuns } from "./tripRuns";

/** Typical length of a vehicle, so that up close a train looks like a train. */
export const BODY_LENGTH_M: Readonly<Record<MovingLayer, number>> = {
	long_rail: 400, // an IC double-deck unit
	regional_rail: 150,
	mountain_rail: 60,
	funicular: 30,
	aerial: 12,
	boat: 60,
};
/** The fading streak behind a vehicle covers its last few minutes of travel. */
export const TAIL_MINUTES = 6;

/** Where one vehicle is at one moment, cut from the exact OSM track. */
export interface VehicleState {
	readonly trip: number;
	readonly layer: MovingLayer;
	readonly head: LonLat;
	/** The vehicle itself: the last `BODY_LENGTH_M` of track, from its rear to its front. */
	readonly body: readonly LonLat[];
	/** Where it travelled in the last `TAIL_MINUTES` of this leg, oldest point first. */
	readonly tail: readonly LonLat[];
	readonly isInsideTunnel: boolean;
	/** The run the vehicle travels (lead-in and legs as one path), and how far along it its front is. */
	readonly path: PathMeasure;
	readonly headM: number;
	/** Where the current leg starts and ends, in the direction of travel. */
	readonly legFrom: LonLat;
	readonly legTo: LonLat;
}

interface PreparedPath {
	readonly points: readonly LonLat[];
	/** Distance from the first point, per point. */
	readonly distancesM: readonly number[];
	readonly lengthM: number;
	readonly tunnelSpansM: readonly (readonly [start: number, end: number])[];
}

/**
 * Answers "where is every vehicle at minute t?" for the precise views.
 *
 * Legs are bucketed by minute, so a frame only looks at the few thousand legs active then.
 * A leg stays active until the trip's next departure, so vehicles wait visibly at stations.
 */
export class VehicleTimeline {
	private readonly paths: readonly PreparedPath[];
	private readonly tripOfLeg: Int32Array;
	/** Minute until which a leg's vehicle is shown: the next leg's departure, or arrival. */
	private readonly shownUntil: Float64Array;
	private readonly bucketStarts: Int32Array;
	private readonly bucketLegs: Int32Array;
	private readonly runs: TripRuns;

	constructor(private readonly motion: Motion) {
		this.runs = new TripRuns(motion);
		this.paths = motion.segments.map(preparePath);
		const legCount = motion.legs.segment.length;
		this.tripOfLeg = new Int32Array(legCount);
		this.shownUntil = new Float64Array(legCount);
		const { first_leg, leg_count } = motion.trips;
		for (let trip = 0; trip < first_leg.length; trip++) {
			const first = at(first_leg, trip);
			const last = first + at(leg_count, trip) - 1;
			for (let leg = first; leg <= last; leg++) {
				this.tripOfLeg[leg] = trip;
				this.shownUntil[leg] = leg < last ? at(motion.legs.depart_minute, leg + 1) : at(motion.legs.arrive_minute, leg);
			}
		}
		[this.bucketStarts, this.bucketLegs] = this.bucketByMinute();
	}

	/** Every vehicle on the move (or waiting at a station) at this minute of the day. */
	vehiclesAt(minute: number): VehicleState[] {
		const vehicles: VehicleState[] = [];
		// Trips running past midnight are stored with minutes above 1440.
		for (const time of [minute, minute + MINUTES_PER_DAY]) {
			for (const leg of this.legsAround(time)) {
				const vehicle = this.vehicleOn(leg, time);
				if (vehicle !== null) vehicles.push(vehicle);
			}
		}
		return vehicles;
	}

	/** Where one trip's vehicle is, or null if it isn't running at this minute. */
	positionOfTrip(trip: number, minute: number): LonLat | null {
		const first = at(this.motion.trips.first_leg, trip);
		const count = at(this.motion.trips.leg_count, trip);
		for (const time of [minute, minute + MINUTES_PER_DAY]) {
			for (let leg = first; leg < first + count; leg++) {
				const vehicle = this.vehicleOn(leg, time);
				if (vehicle !== null) return vehicle.head;
			}
		}
		return null;
	}

	private vehicleOn(leg: number, time: number): VehicleState | null {
		const legs = this.motion.legs;
		const departure = at(legs.depart_minute, leg);
		if (time < departure || time > at(this.shownUntil, leg)) return null;
		const arrival = Math.max(at(legs.arrive_minute, leg), departure);
		const trip = at(this.tripOfLeg, leg);
		const layer = at(this.motion.trips.layer, trip);
		// Positions are measured along the trip's run, so the body reaches back over stations.
		const { run, startM, lengthM } = this.runs.legOnRun(trip, leg);
		const travelledM = (minute: number): number => startM + lengthM * easedProgress(minute, departure, arrival);
		const headM = travelledM(time);
		const tailStartM = travelledM(Math.max(departure, time - TAIL_MINUTES));
		return {
			trip,
			layer,
			path: run.path,
			headM,
			head: run.path.at(headM).point,
			body: run.path.stretch(headM - BODY_LENGTH_M[layer], headM),
			tail: run.path.stretch(tailStartM, headM),
			isInsideTunnel: this.isInsideTunnel(leg, lengthM === 0 ? 0 : (headM - startM) / lengthM),
			legFrom: run.path.at(startM).point,
			legTo: run.path.at(startM + lengthM).point,
		};
	}

	/** Whether the vehicle is in a tunnel, `share` (0..1) of the way along its leg. */
	private isInsideTunnel(leg: number, share: number): boolean {
		const legs = this.motion.legs;
		const path = at(this.paths, at(legs.segment, leg));
		const alongSegmentM = (at(legs.reversed, leg) ? 1 - share : share) * path.lengthM;
		return path.tunnelSpansM.some(([start, end]) => start <= alongSegmentM && alongSegmentM <= end);
	}

	private *legsAround(time: number): Generator<number> {
		const bucket = Math.floor(time);
		if (bucket < 0 || bucket + 1 >= this.bucketStarts.length) return;
		for (let i = at(this.bucketStarts, bucket); i < at(this.bucketStarts, bucket + 1); i++)
			yield at(this.bucketLegs, i);
	}

	/** Compressed buckets: legs active during minute m are bucketLegs[starts[m] .. starts[m+1]]. */
	private bucketByMinute(): [Int32Array, Int32Array] {
		const departures = this.motion.legs.depart_minute;
		const lastMinute = Math.ceil(this.shownUntil.reduce((latest, until) => Math.max(latest, until), 0)) + 1;
		const counts = new Int32Array(lastMinute + 1);
		for (let leg = 0; leg < departures.length; leg++) {
			for (let m = Math.floor(at(departures, leg)); m <= Math.floor(at(this.shownUntil, leg)); m++) {
				counts[m + 1] = at(counts, m + 1) + 1;
			}
		}
		for (let m = 1; m < counts.length; m++) counts[m] = at(counts, m) + at(counts, m - 1);
		const filled = Int32Array.from(counts);
		const legs = new Int32Array(at(counts, counts.length - 1));
		for (let leg = 0; leg < departures.length; leg++) {
			for (let m = Math.floor(at(departures, leg)); m <= Math.floor(at(this.shownUntil, leg)); m++) {
				legs[at(filled, m)] = leg;
				filled[m] = at(filled, m) + 1;
			}
		}
		return [counts, legs];
	}
}

/**
 * Share of the leg travelled, easing out of and into the stations instead of starting and
 * stopping at full speed (smoothstep). Before departure it is 0, after arrival 1.
 */
export function easedProgress(minute: number, departure: number, arrival: number): number {
	if (arrival <= departure) return minute >= arrival ? 1 : 0;
	const linear = Math.min(1, Math.max(0, (minute - departure) / (arrival - departure)));
	return linear * linear * (3 - 2 * linear);
}

function preparePath(segment: Segment): PreparedPath {
	const points = toLonLats(segment.coordinates);
	const distancesM = [0];
	for (let i = 1; i < points.length; i++)
		distancesM.push(at(distancesM, i - 1) + distanceM(at(points, i - 1), at(points, i)));
	const lengthM = distancesM.at(-1) ?? 0;
	return {
		points,
		distancesM,
		lengthM,
		tunnelSpansM: segment.tunnels.map(
			(passage) => [passage.start_fraction * lengthM, passage.end_fraction * lengthM] as const,
		),
	};
}

/** The point at a distance along the path (stored direction). */
export function pointAt(path: PreparedPath, alongM: number): LonLat {
	const index = segmentIndexAt(path, alongM);
	const start = at(path.distancesM, index);
	const end = at(path.distancesM, index + 1);
	const share = end === start ? 0 : (alongM - start) / (end - start);
	return lerpLonLat(at(path.points, index), at(path.points, index + 1), Math.min(1, Math.max(0, share)));
}

/** The piece of path between two distances, ordered from `fromM` to `toM` (either direction). */
export function stretch(path: PreparedPath, fromM: number, toM: number): LonLat[] {
	const low = Math.min(fromM, toM);
	const high = Math.max(fromM, toM);
	const points: LonLat[] = [pointAt(path, low)];
	for (let i = 0; i < path.points.length; i++) {
		const distance = at(path.distancesM, i);
		if (distance > low && distance < high) points.push(at(path.points, i));
	}
	points.push(pointAt(path, high));
	return fromM <= toM ? points : points.reverse();
}

/** Index i such that the distance lies between point i and point i + 1. */
function segmentIndexAt(path: PreparedPath, alongM: number): number {
	let low = 0;
	let high = path.distancesM.length - 2;
	while (low < high) {
		const middle = (low + high + 1) >>> 1;
		if (at(path.distancesM, middle) <= alongM) low = middle;
		else high = middle - 1;
	}
	return Math.max(0, low);
}
