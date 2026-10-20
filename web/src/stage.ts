import type { Layer } from "@deck.gl/core";
import type { CameraMode } from "./camera/camera";
import { toPose } from "./camera/camera";
import type { MapView } from "./map/mapView";
import type { Palette } from "./render/palette";
import type { SceneRegistry } from "./scenes/registry";
import type { Scene, SceneId } from "./scenes/scene";

const CROSSFADE_MS = 1200;
const FPS_SMOOTHING = 0.05;

/**
 * Runs the frame loop's visual side: asks the active scene (and, while cross-fading, the
 * previous one) for layers, and the camera mode where to look, then hands both to the map.
 */
export class Stage {
	private scene: Scene;
	private fadingOut: { scene: Scene; startMs: number } | null = null;
	private framesPerSecond = 60;
	private lastFrameMs = performance.now();

	constructor(
		private readonly map: MapView,
		private readonly scenes: SceneRegistry,
		initialScene: SceneId,
		private camera: CameraMode,
		private palette: Palette,
	) {
		this.scene = scenes.get(initialScene);
		this.scene.show?.();
		map.showMode(this.scene.mapMode);
	}

	get sceneId(): SceneId {
		return this.scene.id;
	}

	get cameraMode(): CameraMode {
		return this.camera;
	}

	showScene(id: SceneId): void {
		if (id === this.scene.id) return;
		this.fadingOut = { scene: this.scene, startMs: performance.now() };
		this.scene = this.scenes.get(id);
		this.scene.show?.();
		this.map.showMode(this.scene.mapMode);
	}

	useCamera(camera: CameraMode): void {
		this.camera = camera;
	}

	usePalette(palette: Palette): void {
		this.palette = palette;
	}

	/** Draws one frame; returns the caption of the current camera shot. */
	render(minute: number, nowMs: number): string | null {
		this.measureFrameRate(nowMs);
		const view = this.camera.viewAt({ minute, current: this.map.pose() });
		if (view !== null) this.map.moveTo(toPose(view, this.map.widthPx()));

		const frame = { minute, nowMs, palette: this.palette, framesPerSecond: this.framesPerSecond };
		const fadeIn = this.fadeInProgress(nowMs);
		const layers: Layer[] = this.scene.layers(frame, fadeIn);
		if (this.fadingOut !== null) layers.unshift(...this.fadingOut.scene.layers(frame, 1 - fadeIn));
		this.map.setDeckLayers(layers);
		return this.camera.captionAt(minute);
	}

	private fadeInProgress(nowMs: number): number {
		if (this.fadingOut === null) return 1;
		const progress = (nowMs - this.fadingOut.startMs) / CROSSFADE_MS;
		if (progress < 1) return progress;
		this.fadingOut.scene.hide?.();
		this.fadingOut = null;
		return 1;
	}

	private measureFrameRate(nowMs: number): void {
		const instantaneous = 1000 / Math.max(1, nowMs - this.lastFrameMs);
		this.framesPerSecond += (instantaneous - this.framesPerSecond) * FPS_SMOOTHING;
		this.lastFrameMs = nowMs;
	}
}
