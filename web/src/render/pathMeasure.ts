import { at } from "../music/collections";
import { distanceM, headingDeg, type LonLat, lerpLonLat } from "./lonLat";

/** A point on a path and the direction the path runs there. */
export interface PointOnPath {
	readonly point: LonLat;
	/** Compass heading towards the end of the path, degrees clockwise from north. */
	readonly headingDeg: number;
}

/** Measures a path once, then answers "where is the point d metres from the start?". */
export class PathMeasure {
	readonly lengthM: number;
	/** Distance from the first point, per point. */
	private readonly distancesM: readonly number[];

	constructor(private readonly points: readonly LonLat[]) {
		const distances = [0];
		for (let i = 1; i < points.length; i++) {
			distances.push(at(distances, i - 1) + distanceM(at(points, i - 1), at(points, i)));
		}
		this.distancesM = distances;
		this.lengthM = distances.at(-1) ?? 0;
	}

	/** Distance from the start to the path's `index`-th point. */
	distanceAtPoint(index: number): number {
		return at(this.distancesM, index);
	}

	/** The point `alongM` metres from the start, clamped to the path's ends. */
	at(alongM: number): PointOnPath {
		const first = this.points[0];
		if (first === undefined) throw new RangeError("an empty path has no points");
		if (this.points.length === 1 || this.lengthM === 0) return { point: first, headingDeg: 0 };
		const clamped = Math.min(this.lengthM, Math.max(0, alongM));
		const index = this.stretchIndexAt(clamped);
		const start = at(this.distancesM, index);
		const end = at(this.distancesM, index + 1);
		const from = at(this.points, index);
		const to = at(this.points, index + 1);
		return {
			point: lerpLonLat(from, to, end === start ? 0 : (clamped - start) / (end - start)),
			headingDeg: headingDeg(from, to),
		};
	}

	/** The piece of path between two distances, ordered from `fromM` to `toM` (either way round). */
	stretch(fromM: number, toM: number): LonLat[] {
		const low = Math.max(0, Math.min(fromM, toM));
		const high = Math.min(this.lengthM, Math.max(fromM, toM));
		const points: LonLat[] = [this.at(low).point];
		for (let i = 0; i < this.points.length; i++) {
			const distance = at(this.distancesM, i);
			if (distance > low && distance < high) points.push(at(this.points, i));
		}
		points.push(this.at(high).point);
		return fromM <= toM ? points : points.reverse();
	}

	/** Index i of the first stretch of non-zero length ending at or after `alongM`. */
	private stretchIndexAt(alongM: number): number {
		const lastStretch = this.points.length - 2;
		for (let i = 0; i < lastStretch; i++) {
			if (at(this.distancesM, i + 1) >= alongM && at(this.distancesM, i + 1) > at(this.distancesM, i)) return i;
		}
		return lastStretch;
	}
}
