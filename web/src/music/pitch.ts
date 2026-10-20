import type { PitchMapping } from "./types";

/** Maps an elevation (metres) to 0..1 given all station elevations. */
export type AltitudeScale = (elevationM: number) => number;

export function altitudeScale(elevations: readonly number[], mapping: PitchMapping): AltitudeScale {
	if (elevations.length === 0) return () => 0;
	const sorted = [...elevations].sort((a, b) => a - b);
	const low = sorted[0] ?? 0;
	const high = sorted[sorted.length - 1] ?? 0;
	const span = high - low;
	if (span === 0) return () => 0;

	switch (mapping) {
		case "linear":
			return (e) => clamp01((e - low) / span);
		case "log":
			// Most stations sit between 300 and 700 m; log spreads the lowlands further apart.
			return (e) => clamp01(Math.log1p(Math.max(0, e - low)) / Math.log1p(span));
		case "rank":
			// Percentile: every part of the register is used equally often.
			return (e) => (sorted.length === 1 ? 0 : upperBound(sorted, e) - 1) / (sorted.length - 1);
	}
}

/** Linear interpolation of a 0..1 value into a [low, high] range. */
export function intoRange(t: number, [low, high]: readonly [number, number]): number {
	return low + clamp01(t) * (high - low);
}

function clamp01(x: number): number {
	return Math.min(1, Math.max(0, x));
}

/** Number of elements <= value in a sorted array. */
function upperBound(sorted: readonly number[], value: number): number {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((sorted[mid] ?? Number.POSITIVE_INFINITY) <= value) lo = mid + 1;
		else hi = mid;
	}
	return Math.max(1, lo);
}
