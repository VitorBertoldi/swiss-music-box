import type { Layer } from "@deck.gl/core";
import { preciseVehicleLayers, vehicleTailLayer } from "../render/preciseVehicleLayers";
import type { FrameState, Scene, SceneAssets } from "./scene";

/**
 * Zoom from which vehicles are drawn as solids (cars, hulls, cabins). At zoom 14 a 27 m train
 * car is about 8 pixels long; further out the solids would be specks, so dots read better.
 */
export const VEHICLE_KINDS_MIN_ZOOM = 14;

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
		const vehicles = timeline.vehiclesAt(frame.minute);
		const vehicleLayers =
			frame.zoom >= VEHICLE_KINDS_MIN_ZOOM
				? [
						vehicleTailLayer(vehicles, frame.palette, opacity, this.id, beneathLabels),
						...vehicleKinds.draw(vehicles, {
							palette: frame.palette,
							opacity,
							idPrefix: this.id,
							beforeId: beneathLabels,
						}),
					]
				: preciseVehicleLayers(vehicles, frame.palette, opacity, this.id, beneathLabels);
		return [
			...tunnels.layers(frame.minute, frame.palette, opacity, true, this.id, beneathLabels),
			...vehicleLayers,
			flashes.layer(frame.nowMs, frame.palette, opacity, this.id, beneathLabels),
		];
	}
}
