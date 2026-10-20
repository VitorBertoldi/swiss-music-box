import type { Layer } from "@deck.gl/core";
import { type VehicleStyle, vehicleLayers } from "../render/vehicleLayers";
import type { FrameState, Scene, SceneAssets } from "./scene";

/** Three hours of trail: the network draws itself as the day goes on. */
const VEHICLES: VehicleStyle = { trailMinutes: 180, widthPx: 1.6, opacity: 0.8, additive: true };

/**
 * Scene 2: light art. Only the national border of the map stays; trails accumulate like a
 * long-exposure photo, and where many trains overlap (the S-Bahn at rush hour) light adds up.
 */
export class LongExposureScene implements Scene {
	readonly id = "long-exposure";
	readonly title = "Long exposure";
	readonly mapMode = "outline";

	constructor(private readonly assets: SceneAssets) {}

	layers(frame: FrameState, opacity: number): Layer[] {
		return vehicleLayers(
			this.assets.overviewVehicles(),
			frame.minute,
			{ ...VEHICLES, opacity: VEHICLES.opacity * opacity },
			this.id,
		);
	}
}
