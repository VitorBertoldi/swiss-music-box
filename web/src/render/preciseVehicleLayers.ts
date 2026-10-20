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

/** Layers for vehicles at their exact positions: fading tail, body, and a head dot. */
export function preciseVehicleLayers(
	vehicles: readonly VehicleState[],
	palette: Palette,
	opacity: number,
	idPrefix: string,
	beforeId: string,
): Layer[] {
	const colourOf = (vehicle: VehicleState): Rgba =>
		withAlpha(palette.vehicles[vehicle.layer], vehicle.isInsideTunnel ? palette.insideTunnelAlpha : 1);
	return [
		new PathLayer<VehicleState, OverlayProps>({
			id: `${idPrefix}-vehicle-tails`,
			data: vehicles,
			getPath: (vehicle) => vehicle.tail as LonLat[],
			getColor: (vehicle) => fadingColours(colourOf(vehicle), vehicle.tail.length),
			getWidth: TAIL_WIDTH_PX,
			widthUnits: "pixels",
			capRounded: true,
			jointRounded: true,
			opacity,
			beforeId,
		}),
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

/** Per-vertex colours from nearly transparent (oldest) to full (current position). */
function fadingColours(colour: Rgba, vertexCount: number): Rgba[] {
	return Array.from({ length: vertexCount }, (_, vertex) => {
		const age = vertexCount <= 1 ? 1 : vertex / (vertexCount - 1);
		return withAlpha(colour, TAIL_START_ALPHA + (1 - TAIL_START_ALPHA) * age);
	});
}
