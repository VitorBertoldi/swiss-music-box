import type { Layer } from "@deck.gl/core";
import { preciseVehicleLayers } from "../render/preciseVehicleLayers";
import type { FrameState, Scene, SceneAssets } from "./scene";

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
		const { timeline, tunnels, flashes, beneathLabels } = this.assets;
		return [
			...tunnels.layers(frame.minute, frame.palette, opacity, true, this.id, beneathLabels),
			...preciseVehicleLayers(timeline.vehiclesAt(frame.minute), frame.palette, opacity, this.id, beneathLabels),
			flashes.layer(frame.nowMs, frame.palette, opacity, this.id, beneathLabels),
		];
	}
}
