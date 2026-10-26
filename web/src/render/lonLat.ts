/** Positions in WGS84 degrees, as stored in the contract files and used by the map. */
export type LonLat = readonly [longitude: number, latitude: number];

const EARTH_RADIUS_M = 6_371_008.8;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Distance in metres between two nearby points (equirectangular approximation).
 * Over the length of a track segment (a few km) it is accurate to far below a metre.
 */
export function distanceM(from: LonLat, to: LonLat): number {
	const meanLatitude = ((from[1] + to[1]) / 2) * DEGREES_TO_RADIANS;
	const east = (to[0] - from[0]) * DEGREES_TO_RADIANS * Math.cos(meanLatitude);
	const north = (to[1] - from[1]) * DEGREES_TO_RADIANS;
	return EARTH_RADIUS_M * Math.hypot(east, north);
}

/** The point a share `t` (0..1) of the way from `from` to `to`. */
export function lerpLonLat(from: LonLat, to: LonLat, t: number): LonLat {
	return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

/** The point `eastM` metres east and `northM` metres north of `origin`. */
export function offsetLonLat(origin: LonLat, eastM: number, northM: number): LonLat {
	const latitude = origin[1] * DEGREES_TO_RADIANS;
	return [
		origin[0] + eastM / (EARTH_RADIUS_M * Math.cos(latitude) * DEGREES_TO_RADIANS),
		origin[1] + northM / (EARTH_RADIUS_M * DEGREES_TO_RADIANS),
	];
}

/** Compass heading from one point towards another: degrees clockwise from north, 0..360. */
export function headingDeg(from: LonLat, to: LonLat): number {
	const meanLatitude = ((from[1] + to[1]) / 2) * DEGREES_TO_RADIANS;
	const east = (to[0] - from[0]) * Math.cos(meanLatitude);
	const north = to[1] - from[1];
	const degrees = Math.atan2(east, north) / DEGREES_TO_RADIANS;
	return (degrees + 360) % 360;
}

/** Flat [longitude, latitude, ...] (as in the contract files) to points. */
export function toLonLats(flatCoordinates: readonly number[]): LonLat[] {
	const points: LonLat[] = [];
	for (let i = 0; i + 1 < flatCoordinates.length; i += 2) {
		points.push([flatCoordinates[i] as number, flatCoordinates[i + 1] as number]);
	}
	return points;
}
