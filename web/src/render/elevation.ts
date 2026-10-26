/**
 * Where the ground is, for everything drawn on the map. A strategy chosen per frame: the same
 * vehicles, trails and flashes work on the flat map (the shared link) and on the 3D terrain.
 */
export interface Elevation {
	readonly isTerrain: boolean;
	/** The altitude to draw at, in metres, for a point `heightM` above sea level. */
	altitudeM(heightM: number): number;
}

/** Everything at sea level: the map lies flat and heights only show as relative offsets. */
export const FLAT_MAP: Elevation = { isTerrain: false, altitudeM: () => 0 };

/** True altitudes, standing on the terrain MapLibre raises the map over (exaggeration 1). */
export const TERRAIN: Elevation = { isTerrain: true, altitudeM: (heightM) => heightM };

/** A position in metres above sea level, ready for deck.gl once an elevation is applied. */
export type LonLatHeight = readonly [longitude: number, latitude: number, heightM: number];

/** deck.gl position for a point at its height, under this elevation. */
export function placed(elevation: Elevation, [longitude, latitude, heightM]: LonLatHeight): [number, number, number] {
	return [longitude, latitude, elevation.altitudeM(heightM)];
}
