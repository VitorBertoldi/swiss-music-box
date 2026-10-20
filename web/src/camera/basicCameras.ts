import type { CameraMode, CameraView } from "./camera";

/** All of Switzerland, from straight above. */
export const SWITZERLAND_VIEW: CameraView = { centre: [8.23, 46.8], spanM: 380_000, pitch: 0, bearing: 0 };

/** Holds one view all day; the default is the whole country. */
export class OverviewCamera implements CameraMode {
	readonly id = "overview";

	constructor(private readonly view: CameraView = SWITZERLAND_VIEW) {}

	viewAt(): CameraView {
		return this.view;
	}

	captionAt(): string | null {
		return null;
	}
}

/** Leaves the camera to the person at the controls (drag, scroll, right-drag to tilt). */
export class FreeCamera implements CameraMode {
	readonly id = "free";

	viewAt(): null {
		return null;
	}

	captionAt(): string | null {
		return null;
	}
}
