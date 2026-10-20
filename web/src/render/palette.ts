import type { Trips } from "../contract/motion";

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];
export type MovingLayer = Trips["layer"][number];

/** Colours of the street map, by OpenMapTiles feature class. */
export interface MapColours {
	readonly background: Rgba;
	readonly water: Rgba;
	readonly waterway: Rgba;
	readonly wood: Rgba;
	readonly grass: Rgba;
	readonly farmland: Rgba;
	readonly rock: Rgba;
	readonly ice: Rgba;
	readonly residential: Rgba;
	readonly industrial: Rgba;
	readonly building: Rgba;
	readonly motorway: Rgba;
	readonly majorRoad: Rgba;
	readonly minorRoad: Rgba;
	readonly serviceRoad: Rgba;
	readonly path: Rgba;
	readonly rail: Rgba;
	readonly aerialway: Rgba;
	readonly border: Rgba;
	readonly label: Rgba;
	readonly labelHalo: Rgba;
	/** Opacity of the shaded relief at country scale (it fades out when zooming in). */
	readonly reliefOpacity: number;
}

/** Every colour the visuals use. Two strategies: a screen palette and a projector palette. */
export interface Palette {
	readonly name: string;
	readonly map: MapColours;
	readonly vehicles: Readonly<Record<MovingLayer, Rgba>>;
	/** Multiplier for a vehicle's alpha while it is inside a tunnel. */
	readonly insideTunnelAlpha: number;
	readonly tunnelGlow: Rgba;
	readonly label: Rgba;
}

const VEHICLES: Palette["vehicles"] = {
	long_rail: [255, 75, 75, 255],
	regional_rail: [255, 160, 120, 220],
	mountain_rail: [255, 176, 58, 255],
	funicular: [185, 140, 255, 255],
	aerial: [244, 241, 255, 255],
	boat: [63, 180, 255, 255],
};

/** A night map: dark ground, so moving light reads first. */
const SCREEN_MAP: MapColours = {
	background: [6, 8, 13, 255],
	water: [14, 34, 58, 255],
	waterway: [30, 70, 110, 255],
	wood: [14, 24, 19, 255],
	grass: [17, 24, 20, 255],
	farmland: [15, 19, 18, 255],
	rock: [24, 26, 31, 255],
	ice: [38, 44, 54, 255],
	residential: [17, 20, 28, 255],
	industrial: [21, 21, 27, 255],
	building: [32, 37, 48, 255],
	motorway: [225, 195, 145, 160],
	majorRoad: [190, 195, 208, 120],
	minorRoad: [150, 156, 172, 90],
	serviceRoad: [120, 126, 142, 70],
	path: [120, 150, 120, 90],
	rail: [215, 220, 232, 140],
	aerialway: [235, 235, 255, 120],
	border: [230, 235, 245, 150],
	label: [200, 207, 220, 255],
	labelHalo: [6, 8, 13, 230],
	reliefOpacity: 0.45,
};

export const SCREEN_PALETTE: Palette = {
	name: "screen",
	map: SCREEN_MAP,
	vehicles: VEHICLES,
	insideTunnelAlpha: 0.15,
	tunnelGlow: [124, 92, 255, 255],
	label: [232, 236, 244, 230],
};

/**
 * Projectors wash out dark greys and thin lines, so the ground is pure black and roads,
 * rail and labels are brighter; vehicles keep their colours so they stay recognisable.
 */
export const PROJECTOR_PALETTE: Palette = {
	...SCREEN_PALETTE,
	name: "projector",
	map: {
		...SCREEN_MAP,
		background: [0, 0, 0, 255],
		water: [20, 50, 88, 255],
		building: [44, 50, 64, 255],
		majorRoad: [215, 220, 232, 170],
		minorRoad: [180, 186, 200, 130],
		rail: [235, 240, 250, 190],
		border: [255, 255, 255, 190],
		label: [235, 240, 248, 255],
		reliefOpacity: 0.6,
	},
};

export function withAlpha(colour: Rgba, alphaScale: number): Rgba {
	return [colour[0], colour[1], colour[2], Math.round(colour[3] * alphaScale)];
}

export function toCss(colour: Rgba): string {
	return `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${(colour[3] / 255).toFixed(3)})`;
}
