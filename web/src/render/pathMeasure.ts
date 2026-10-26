import { at } from "../music/collections";
import type { LonLatHeight } from "./elevation";
import { distanceM, headingDeg, type LonLat, lerpLonLat } from "./lonLat";

/** A point on a path, its height, and the direction the path runs there. */
export interface PointOnPath {
	readonly point: LonLat;
	/** Height above sea level, in metres (0 when the path has no heights). */
	readonly heightM: number;
	/** Compass heading towards the end of the path, degrees clockwise from north. */
	readonly headingDeg: number;
}

/**
 * Measures a path once, then answers "where is the point d metres from the start, and how
 * high?" in logarithmic time, as a frame asks it a few times per train car.
 */
export class PathMeasure {
	readonly lengthM: number;
	/** Distance from the first point, per point. */
	private readonly distancesM: readonly number[];
	private readonly heightsM: readonly number[];

	constructor(
		private readonly points: readonly LonLat[],
		heightsM?: readonly number[],
	) {
		if (heightsM !== undefined && heightsM.length !== points.length) {
			throw new RangeError(`${heightsM.length} heights for ${points.length} points`);
		}
		const distances = [0];
		for (let i = 1; i < points.length; i++) {
			distances.push(at(distances, i - 1) + distanceM(at(points, i - 1), at(points, i)));
		}
		this.distancesM = distances;
		this.lengthM = distances.at(-1) ?? 0;
		this.heightsM = heightsM ?? points.map(() => 0);
	}

	/** Distance from the start to the path's `index`-th point. */
	distanceAtPoint(index: number): number {
		return at(this.distancesM, index);
	}

	/** The point `alongM` metres from the start, clamped to the path's ends. */
	at(alongM: number): PointOnPath {
		const first = this.points[0];
		if (first === undefined) throw new RangeError("an empty path has no points");
		if (this.points.length === 1 || this.lengthM === 0) {
			return { point: first, heightM: at(this.heightsM, 0), headingDeg: 0 };
		}
		const clamped = Math.min(this.lengthM, Math.max(0, alongM));
		const index = this.stretchIndexAt(clamped);
		const start = at(this.distancesM, index);
		const end = at(this.distancesM, index + 1);
		const share = end === start ? 0 : (clamped - start) / (end - start);
		const lowHeight = at(this.heightsM, index);
		return {
			point: lerpLonLat(at(this.points, index), at(this.points, index + 1), share),
			heightM: lowHeight + (at(this.heightsM, index + 1) - lowHeight) * share,
			headingDeg: headingDeg(at(this.points, index), at(this.points, index + 1)),
		};
	}

	/** The piece of path between two distances, ordered from `fromM` to `toM` (either way round). */
	stretch(fromM: number, toM: number): LonLat[] {
		return this.stretchWithHeights(fromM, toM).map(([longitude, latitude]): LonLat => [longitude, latitude]);
	}

	/** Like `stretch`, with the height of every point. */
	stretchWithHeights(fromM: number, toM: number): LonLatHeight[] {
		const low = Math.max(0, Math.min(fromM, toM));
		const high = Math.min(this.lengthM, Math.max(fromM, toM));
		const withHeight = ({ point, heightM }: PointOnPath): LonLatHeight => [point[0], point[1], heightM];
		const points: LonLatHeight[] = [withHeight(this.at(low))];
		for (let i = this.firstPointAfter(low); i < this.points.length && at(this.distancesM, i) < high; i++) {
			const [longitude, latitude] = at(this.points, i);
			points.push([longitude, latitude, at(this.heightsM, i)]);
		}
		points.push(withHeight(this.at(high)));
		return fromM <= toM ? points : points.reverse();
	}

	/** Index of the first point lying strictly beyond `alongM`. */
	private firstPointAfter(alongM: number): number {
		let low = 0;
		let high = this.distancesM.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (at(this.distancesM, middle) <= alongM) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	/** Index i of the stretch from point i to i + 1 holding `alongM`, skipping zero-length ones. */
	private stretchIndexAt(alongM: number): number {
		const lastStretch = this.points.length - 2;
		let index = Math.min(lastStretch, Math.max(0, this.firstPointAfter(alongM) - 1));
		while (index < lastStretch && at(this.distancesM, index + 1) === at(this.distancesM, index)) index++;
		return index;
	}
}
