import type { Layer } from "@deck.gl/core";
import type { MapMode } from "../map/mapView";
import type { StationFlashes } from "../render/flashes";
import type { Palette } from "../render/palette";
import type { TunnelGlow } from "../render/tunnelLayers";
import type { VehicleBuffers } from "../render/vehicleLayers";
import type { VehicleTimeline } from "../render/vehicleTimeline";
import type { VehicleKindRegistry } from "../vehicles/registry";

export type SceneId = "living-map" | "long-exposure" | "calibration";

/** Everything a scene may look at to draw one frame. */
export interface FrameState {
	/** Timetable minute being played (fractional). */
	readonly minute: number;
	/** `performance.now()` of this frame. */
	readonly nowMs: number;
	readonly palette: Palette;
	readonly framesPerSecond: number;
	/** Map zoom of this frame; scenes draw more detail closer in. */
	readonly zoom: number;
	/** Ground metres per screen pixel at the centre of the view. */
	readonly metresPerPixel: number;
}

/** The shared, prepared data every scene draws from. */
export interface SceneAssets {
	/** Exact vehicle positions, for the views you can zoom into. */
	readonly timeline: VehicleTimeline;
	/** How each kind of vehicle looks up close. */
	readonly vehicleKinds: VehicleKindRegistry;
	/** GPU trails on overview geometry; recoloured when the palette changes, hence a function. */
	readonly overviewVehicles: () => VehicleBuffers;
	readonly flashes: StationFlashes;
	readonly tunnels: TunnelGlow;
	/** The map layer below which vehicles are drawn, so labels stay on top. */
	readonly beneathLabels: string;
}

/** A way of showing the day. Scenes are interchangeable while the music keeps playing. */
export interface Scene {
	readonly id: SceneId;
	readonly title: string;
	/** Which parts of the street map this scene shows. */
	readonly mapMode: MapMode;
	/** Layers for this frame; `opacity` < 1 while cross-fading between scenes. */
	layers(frame: FrameState, opacity: number): Layer[];
	/** Called when the scene becomes visible or hidden (e.g. to show a DOM overlay). */
	show?(): void;
	hide?(): void;
}
