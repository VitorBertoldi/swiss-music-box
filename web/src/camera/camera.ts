import type { CameraPose } from "../map/mapView";
import type { LonLat } from "../render/lonLat";

/** What the camera should show: a place, how much of it, and from which angle. */
export interface CameraView {
	readonly centre: LonLat;
	/** Width of ground visible across the screen, in metres. */
	readonly spanM: number;
	/** Tilt from straight down, degrees (0 = map view; ~60 = looking over the rooftops). */
	readonly pitch: number;
	/** Rotation, degrees clockwise from north. */
	readonly bearing: number;
}

/** What a camera mode may look at to decide where to point. */
export interface CameraContext {
	readonly minute: number;
	/** Where the camera is right now (moved by a person, or by the previous frame). */
	readonly current: CameraPose;
}

export type CameraModeId = "free" | "overview" | "tour" | "follow";

/** Where the camera looks over the day. A strategy: the stage asks it every frame. */
export interface CameraMode {
	readonly id: CameraModeId;
	/** The view to show, or null to leave the camera where a person put it. */
	viewAt(context: CameraContext): CameraView | null;
	/** What the current shot shows, for the on-screen caption (null: no caption). */
	captionAt(minute: number): string | null;
}

/** Ground metres covered by one pixel at zoom 0 on the equator (512 px Web Mercator tiles). */
const METRES_PER_PIXEL_AT_ZOOM_0 = (2 * Math.PI * 6_378_137) / 512;

/** Ground metres covered by one screen pixel at this zoom and latitude. */
export function metresPerPixel(zoom: number, latitude: number): number {
	return (METRES_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/** The Web Mercator zoom at which `spanM` of ground fills `viewportWidthPx` pixels. */
export function zoomForSpan(spanM: number, latitude: number, viewportWidthPx: number): number {
	const metresPerPixelAtZoom0 = METRES_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180);
	return Math.log2((metresPerPixelAtZoom0 * viewportWidthPx) / spanM);
}

export function toPose(view: CameraView, viewportWidthPx: number): CameraPose {
	return {
		centre: view.centre,
		zoom: zoomForSpan(view.spanM, view.centre[1], viewportWidthPx),
		pitch: view.pitch,
		bearing: view.bearing,
	};
}
