import type { Layer } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { OverlayProps } from "../map/overlayProps";
import { type Elevation, placed } from "./elevation";
import { type Palette, type Rgba, withAlpha } from "./palette";
import { BODY_LENGTH_M, type VehicleState } from "./vehicleTimeline";

const TAIL_WIDTH_PX = 2;
const TAIL_START_ALPHA = 0.05; // the oldest end of the streak is almost transparent
const BODY_WIDTH_M = 4; // about a train's width, visible when zoomed into a street
const BODY_MIN_WIDTH_PX = 2.5;
const HEAD_RADIUS_PX = 2.5; // keeps every vehicle visible as a dot at country scale

/** What drawing into a frame needs, shared by schematic vehicles and vehicle kinds. */
export interface LayerFrame {
	readonly palette: Palette;
	readonly opacity: number;
	/** Prefix for deck.gl layer ids, unique per scene. */
	readonly idPrefix: string;
	/** The map layer to draw below, so labels stay on top. */
	readonly beforeId: string;
	readonly elevation: Elevation;
}

/** A path of drawn positions with one colour per vertex. */
export interface ColouredPath {
	readonly path: [number, number, number][];
	readonly colours: Rgba[];
}

/** Vehicles at their exact positions, drawn schematically: fading tail, body, and a head dot. */
export function preciseVehicleLayers(vehicles: readonly VehicleState[], frame: LayerFrame): Layer[] {
	const { palette, opacity, idPrefix, beforeId, elevation } = frame;
	const colourOf = (vehicle: VehicleState): Rgba => vehicleColour(vehicle, palette);
	return [
		vehicleTailLayer(vehicles, frame),
		new PathLayer<VehicleState, OverlayProps>({
			id: `${idPrefix}-vehicle-bodies`,
			data: vehicles,
			getPath: (vehicle) =>
				vehicle.path
					.stretchWithHeights(vehicle.headM - BODY_LENGTH_M[vehicle.layer], vehicle.headM)
					.map((point) => placed(elevation, point)),
			getColor: (vehicle) => [...colourOf(vehicle)],
			getWidth: BODY_WIDTH_M,
			widthUnits: "meters",
			widthMinPixels: BODY_MIN_WIDTH_PX,
			capRounded: true,
			jointRounded: true,
			opacity,
			beforeId,
		}),
		new ScatterplotLayer<VehicleState, OverlayProps>({
			id: `${idPrefix}-vehicle-heads`,
			data: vehicles,
			getPosition: (vehicle) => {
				const { point, heightM } = vehicle.path.at(vehicle.headM);
				return placed(elevation, [point[0], point[1], heightM]);
			},
			getFillColor: (vehicle) => [...colourOf(vehicle)],
			getRadius: HEAD_RADIUS_PX,
			radiusUnits: "pixels",
			opacity,
			beforeId,
		}),
	];
}

/** Where a vehicle travelled over the last few minutes, at its drawn altitude. */
export function trailOf(vehicle: VehicleState, elevation: Elevation): [number, number, number][] {
	return vehicle.path.stretchWithHeights(vehicle.tailStartM, vehicle.headM).map((point) => placed(elevation, point));
}

/** Each vehicle's trail, fading from `colourOf(vehicle)` at its front to almost nothing. */
export function fadingTrails(
	vehicles: readonly VehicleState[],
	elevation: Elevation,
	colourOf: (vehicle: VehicleState) => Rgba,
): ColouredPath[] {
	return vehicles.map((vehicle) => {
		const path = trailOf(vehicle, elevation);
		return { path, colours: fadingColours(colourOf(vehicle), path.length) };
	});
}

/** The fading streak behind each vehicle: where it was over the last few minutes. */
export function vehicleTailLayer(vehicles: readonly VehicleState[], frame: LayerFrame): Layer {
	return new PathLayer<ColouredPath, OverlayProps>({
		id: `${frame.idPrefix}-vehicle-tails`,
		data: fadingTrails(vehicles, frame.elevation, (vehicle) => vehicleColour(vehicle, frame.palette)),
		getPath: (trail) => trail.path,
		getColor: (trail) => trail.colours,
		getWidth: TAIL_WIDTH_PX,
		widthUnits: "pixels",
		capRounded: true,
		jointRounded: true,
		opacity: frame.opacity,
		beforeId: frame.beforeId,
	});
}

function vehicleColour(vehicle: VehicleState, palette: Palette): Rgba {
	return withAlpha(palette.vehicles[vehicle.layer], vehicle.isInsideTunnel ? palette.insideTunnelAlpha : 1);
}

/** Per-vertex colours from nearly transparent (oldest) to full (current position). */
export function fadingColours(colour: Rgba, vertexCount: number): Rgba[] {
	return Array.from({ length: vertexCount }, (_, vertex) => {
		const age = vertexCount <= 1 ? 1 : vertex / (vertexCount - 1);
		return withAlpha(colour, TAIL_START_ALPHA + (1 - TAIL_START_ALPHA) * age);
	});
}
