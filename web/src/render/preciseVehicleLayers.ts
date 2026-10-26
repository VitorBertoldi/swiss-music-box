import type { Layer } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { OverlayProps } from "../map/overlayProps";
import type { LonLat } from "./lonLat";
import { type Palette, type Rgba, withAlpha } from "./palette";
import type { VehicleState } from "./vehicleTimeline";

const TAIL_WIDTH_PX = 2;
const TAIL_START_ALPHA = 0.05; // the oldest end of the streak is almost transparent
const BODY_WIDTH_M = 4; // about a train's width, visible when zoomed into a street
const BODY_MIN_WIDTH_PX = 2.5;
const HEAD_RADIUS_PX = 2.5; // keeps every vehicle visible as a dot at country scale

/** Vehicles at their exact positions, drawn schematically: fading tail, body, and a head dot. */
export function preciseVehicleLayers(
	vehicles: readonly VehicleState[],
	palette: Palette,
	opacity: number,
	idPrefix: string,
	beforeId: string,
): Layer[] {
	const colourOf = (vehicle: VehicleState): Rgba => vehicleColour(vehicle, palette);
	return [
		vehicleTailLayer(vehicles, palette, opacity, idPrefix, beforeId),
		new PathLayer<VehicleState, OverlayProps>({
			id: `${idPrefix}-vehicle-bodies`,
			data: vehicles,
			getPath: (vehicle) => vehicle.body as LonLat[],
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
			getPosition: (vehicle) => vehicle.head as LonLat,
			getFillColor: (vehicle) => [...colourOf(vehicle)],
			getRadius: HEAD_RADIUS_PX,
			radiusUnits: "pixels",
			opacity,
			beforeId,
		}),
	];
}

/** The fading streak behind each vehicle: where it was over the last few minutes. */
export function vehicleTailLayer(
	vehicles: readonly VehicleState[],
	palette: Palette,
	opacity: number,
	idPrefix: string,
	beforeId: string,
): Layer {
	return new PathLayer<VehicleState, OverlayProps>({
		id: `${idPrefix}-vehicle-tails`,
		data: vehicles,
		getPath: (vehicle) => vehicle.tail as LonLat[],
		getColor: (vehicle) => fadingColours(vehicleColour(vehicle, palette), vehicle.tail.length),
		getWidth: TAIL_WIDTH_PX,
		widthUnits: "pixels",
		capRounded: true,
		jointRounded: true,
		opacity,
		beforeId,
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
