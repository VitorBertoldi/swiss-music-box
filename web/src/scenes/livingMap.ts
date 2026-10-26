import type { Layer } from "@deck.gl/core";
import { type LayerFrame, preciseVehicleLayers, vehicleTailLayer } from "../render/preciseVehicleLayers";
import type { FrameState, Scene, SceneAssets } from "./scene";

/**
 * Zoom from which vehicles are drawn as what they are (cars, hulls, cabins). At zoom 14 a 27 m
 * train car is about 8 pixels long; further out the solids would be specks, so dots read better.
 */
export const VEHICLE_KINDS_MIN_ZOOM = 14;
/** Up close the trail is only a hint of where a vehicle came from; the vehicle itself leads. */
const CLOSE_UP_TRAIL_OPACITY = 0.3;

/**
 * Scene 1: the cartographic view. The OSM street map with every vehicle at its exact
 * position on the track; zoom in to see trains as trains, between real buildings.
 */
export class LivingMapScene implements Scene {
	readonly id = "living-map";
	readonly title = "Living map";
	readonly mapMode = "full";

	constructor(private readonly assets: SceneAssets) {}

	layers(frame: FrameState, opacity: number): Layer[] {
		const { timeline, vehicleKinds, tunnels, flashes, beneathLabels } = this.assets;
		const drawing: LayerFrame = {
			palette: frame.palette,
			opacity,
			idPrefix: this.id,
			beforeId: beneathLabels,
			elevation: frame.elevation,
		};
		const vehicles = timeline.vehiclesAt(frame.minute);
		const vehicleLayers =
			frame.zoom >= VEHICLE_KINDS_MIN_ZOOM
				? [
						vehicleTailLayer(vehicles, { ...drawing, opacity: opacity * CLOSE_UP_TRAIL_OPACITY }),
						...vehicleKinds.draw(vehicles, {
							...drawing,
							nowMs: frame.nowMs,
							metresPerPixel: frame.metresPerPixel,
							visibleArea: frame.visibleArea,
						}),
					]
				: preciseVehicleLayers(vehicles, drawing);
		return [...tunnels.layers(frame.minute, drawing, true), ...vehicleLayers, flashes.layer(frame.nowMs, drawing)];
	}
}
