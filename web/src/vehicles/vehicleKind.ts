import type { Layer } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";
import type { OverlayProps } from "../map/overlayProps";
import type { MovingLayer, Palette, Rgba } from "../render/palette";
import type { VehicleState } from "../render/vehicleTimeline";
import type { MotionModel } from "./motion";
import type { Corner, Shape } from "./shape";

/** What a vehicle kind needs to know about the frame it draws into. */
export interface VehicleFrame {
	readonly palette: Palette;
	readonly opacity: number;
	/** Prefix for deck.gl layer ids, unique per scene. */
	readonly idPrefix: string;
	/** The map layer to draw below, so labels stay on top. */
	readonly beforeId: string;
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

/** Every part of every vehicle, placed by the motion model and shaped by the shape. */
export function solidsOf(vehicles: readonly VehicleState[], motion: MotionModel, shape: Shape, colour: Rgba): Solid[] {
	return vehicles.flatMap((vehicle) =>
		motion.place(vehicle).map((placement) => ({
			footprint: shape.footprint(placement),
			heightM: shape.heightM,
			colour,
		})),
	);
}

/** Solids drawn as extruded footprints, lit by deck.gl, standing among the 3D buildings. */
export function solidLayer(id: string, solids: readonly Solid[], frame: VehicleFrame): Layer {
	return new SolidPolygonLayer<Solid, OverlayProps>({
		id,
		data: solids,
		getPolygon: (solid) => solid.footprint,
		getElevation: (solid) => solid.heightM,
		getFillColor: (solid) => [...solid.colour],
		extruded: true,
		opacity: frame.opacity,
		beforeId: frame.beforeId,
	});
}

/** The kind's colour without the palette's transparency: solids look wrong see-through. */
export function solidColour(palette: Palette, layer: MovingLayer): Rgba {
	const [red, green, blue] = palette.vehicles[layer];
	return [red, green, blue, 255];
}
