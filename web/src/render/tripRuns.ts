import type { Motion } from "../contract/motion";
import { at } from "../music/collections";
import { type LonLat, toLonLats } from "./lonLat";
import { PathMeasure } from "./pathMeasure";

/**
 * Part of a trip the train travels without turning back: the track behind its start (the
 * lead-in, where a waiting train's rear cars stand), then its legs, as one measured path.
 * Cutting a train's body from a run, not from a single leg, keeps it whole through stations.
 */
export interface TripRun {
	readonly path: PathMeasure;
}

/** Where one leg lies on its run. */
export interface LegOnRun {
	readonly run: TripRun;
	/** Distance along the run where the leg starts. */
	readonly startM: number;
	readonly lengthM: number;
}

const NO_LEAD_IN = -1;
/** Runs are built for the trips on screen and forgotten in bulk once this many are cached. */
const MAX_CACHED_TRIPS = 5000;

/** Builds the runs of a trip when first asked, from the motion file's legs and lead-ins. */
export class TripRuns {
	private readonly legsOfTrip = new Map<number, ReadonlyMap<number, LegOnRun>>();

	constructor(private readonly motion: Motion) {}

	/** Where `leg` (of `trip`) lies on its run. */
	legOnRun(trip: number, leg: number): LegOnRun {
		let legs = this.legsOfTrip.get(trip);
		if (legs === undefined) {
			if (this.legsOfTrip.size >= MAX_CACHED_TRIPS) this.legsOfTrip.clear();
			legs = this.build(trip);
			this.legsOfTrip.set(trip, legs);
		}
		const placed = legs.get(leg);
		if (placed === undefined) throw new RangeError(`leg ${leg} is not part of trip ${trip}`);
		return placed;
	}

	private build(trip: number): Map<number, LegOnRun> {
		const { legs, segments, lead_ins } = this.motion;
		const first = at(this.motion.trips.first_leg, trip);
		const count = at(this.motion.trips.leg_count, trip);
		const placed = new Map<number, LegOnRun>();
		let points: LonLat[] = [];
		let legStarts: [leg: number, pointIndex: number][] = [];
		const finishRun = (): void => {
			if (legStarts.length === 0) return;
			const run: TripRun = { path: new PathMeasure(points) };
			const ends = [...legStarts.slice(1).map(([, index]) => index), points.length - 1];
			legStarts.forEach(([leg, startIndex], i) => {
				const startM = run.path.distanceAtPoint(startIndex);
				placed.set(leg, { run, startM, lengthM: run.path.distanceAtPoint(at(ends, i)) - startM });
			});
		};
		for (let leg = first; leg < first + count; leg++) {
			const leadIn = at(legs.lead_in, leg);
			if (leadIn !== NO_LEAD_IN || legStarts.length === 0) {
				finishRun();
				points = leadIn === NO_LEAD_IN ? [] : toLonLats(at(lead_ins, leadIn).coordinates);
				legStarts = [];
			}
			const segment = toLonLats(at(segments, at(legs.segment, leg)).coordinates);
			const travelled = at(legs.reversed, leg) ? segment.reverse() : segment;
			// A leg continuing the run starts where the previous one ended: if it leaves from
			// another platform track, the short way across the station is part of its departure.
			const continuesRun = legStarts.length > 0;
			const sharesFirstPoint = sameLonLat(points.at(-1), travelled[0]);
			legStarts.push([leg, continuesRun || sharesFirstPoint ? points.length - 1 : points.length]);
			points.push(...(sharesFirstPoint ? travelled.slice(1) : travelled));
		}
		finishRun();
		return placed;
	}
}

function sameLonLat(a: LonLat | undefined, b: LonLat | undefined): boolean {
	return a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
}
