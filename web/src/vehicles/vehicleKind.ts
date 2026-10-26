import type { Layer } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import type { LonLatBox } from "../map/mapView";
import type { OverlayProps } from "../map/overlayProps";
import type { MovingLayer, Palette, Rgba } from "../render/palette";
import type { LayerFrame } from "../render/preciseVehicleLayers";
import type { VehicleState } from "../render/vehicleTimeline";
import type { PoseContext } from "./motion";
import type { Corner } from "./shape";

/** What a vehicle kind needs to know about the frame it draws into. */
export interface VehicleFrame extends PoseContext, LayerFrame {
	/** Ground metres per screen pixel, to keep small vehicles visible from further out. */
	readonly metresPerPixel: number;
	/** Vehicles outside this area aren't drawn. */
	readonly visibleArea: LonLatBox;
}

/**
 * Narrowest a solid is drawn, in screen pixels. A 2.8 m train car is a hairline at zoom 15,
 * so further out vehicles are drawn wider than they are (their length stays true), as maps
 * draw roads wider than they are.
 */
export const MIN_SOLID_WIDTH_PX = 8;

/** The narrowest width that is still visible in this frame, in metres. */
export function minimumWidthM(frame: VehicleFrame): number {
	return MIN_SOLID_WIDTH_PX * frame.metresPerPixel;
}

/**
 * How one kind of vehicle looks and moves when seen up close. There is one instance per kind,
 * never one per vehicle: it draws all vehicles of its kind at once, as deck.gl wants.
 */
export interface VehicleKind {
	readonly layer: MovingLayer;
	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[];
}

/** One solid part of one vehicle, ready to draw. */
export interface Solid {
	readonly footprint: Corner[];
	readonly heightM: number;
	readonly colour: Rgba;
}

/** A colour mixed `share` of the way towards white. */
export function lighter(colour: Rgba, share: number): Rgba {
	const [red, green, blue, alpha] = colour;
	const mix = (channel: number): number => Math.round(channel + (255 - channel) * share);
	return [mix(red), mix(green), mix(blue), alpha];
}

/** More ambient light than deck.gl's default, so vehicle colours stay vivid on the dark map. */
export const SOLID_MATERIAL = {
	ambient: 0.65,
	diffuse: 0.55,
	shininess: 24,
	specularColor: [60, 64, 70] as [number, number, number],
};

/** Solids drawn as extruded footprints, lit by deck.gl, standing among the 3D buildings. */
export function solidLayer(id: string, solids: readonly Solid[], frame: VehicleFrame): Layer {
	return new SolidPolygonLayer<Solid, OverlayProps>({
		id,
		data: solids,
		getPolygon: (solid) => solid.footprint,
		getElevation: (solid) => solid.heightM,
		getFillColor: (solid) => [...solid.colour],
		extruded: true,
		material: SOLID_MATERIAL,
		opacity: frame.opacity,
		beforeId: frame.beforeId,
	});
}

/** The kind's colour without the palette's transparency: solids look wrong see-through. */
export function solidColour(palette: Palette, layer: MovingLayer): Rgba {
	const [red, green, blue] = palette.vehicles[layer];
	return [red, green, blue, 255];
}
