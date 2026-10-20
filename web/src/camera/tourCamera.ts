import { at } from "../music/collections";
import { MINUTES_PER_DAY } from "../music/constants";
import { SWITZERLAND_VIEW } from "./basicCameras";
import type { CameraMode, CameraView } from "./camera";

/** One stop of the tour: from `fromMinute` on, the camera shows this place. */
export interface Shot {
	readonly fromMinute: number;
	readonly caption: string;
	readonly view: CameraView;
}

/** How long the camera takes to fly from one shot to the next, in timetable minutes. */
export const TRANSITION_MINUTES = 40;
/** Tilt for close shots, so buildings stand up in 3D. */
const STREET_PITCH = 60;

function shot(
	caption: string,
	fromHour: number,
	longitude: number,
	latitude: number,
	spanKm: number,
	pitch = 0,
	bearing = 0,
): Shot {
	return {
		fromMinute: fromHour * 60,
		caption,
		view: { centre: [longitude, latitude], spanM: spanKm * 1000, pitch, bearing },
	};
}

const COUNTRY = (fromHour: number): Shot => ({
	fromMinute: fromHour * 60,
	caption: "Switzerland",
	view: SWITZERLAND_VIEW,
});

/** A day with the camera: where something characteristic happens at that hour. */
export const DEFAULT_TOUR: readonly Shot[] = [
	COUNTRY(0),
	shot("Zürich HB · morning rush", 6.5, 8.5402, 47.3779, 2.5, STREET_PITCH, -30),
	shot("Zürich · the S-Bahn network", 7.5, 8.55, 47.38, 30),
	shot("Bern, Thun and the Lötschberg", 8.25, 7.62, 46.7, 90),
	shot("Jungfrau region · first cable cars", 9.5, 7.93, 46.6, 25, 45, 160),
	shot("Lake Geneva · boats", 11, 6.6, 46.43, 70),
	COUNTRY(12.75),
	shot("Bern station · midday", 13.75, 7.4392, 46.949, 2, STREET_PITCH, 20),
	shot("Graubünden · Albula and Vereina", 14.5, 9.85, 46.7, 70),
	shot("Gotthard and Ceneri", 16.5, 8.85, 46.45, 110),
	shot("Zürich · evening rush", 18, 8.55, 47.38, 40),
	COUNTRY(19.5),
	shot("Lugano by night", 22, 8.947, 46.005, 6, 45, 0),
	COUNTRY(23.25),
];

/** Flies between shots; the span is interpolated in log space so zooming neither lurches nor crawls. */
export class TourCamera implements CameraMode {
	readonly id = "tour";

	constructor(private readonly shots: readonly Shot[] = DEFAULT_TOUR) {
		if (shots.length === 0) throw new Error("a tour needs at least one shot");
	}

	viewAt({ minute }: { readonly minute: number }): CameraView {
		const { current, next, minutesUntilNext } = this.neighbours(minute);
		if (minutesUntilNext > TRANSITION_MINUTES) return current.view;
		return interpolateView(current.view, next.view, easeInOut(1 - minutesUntilNext / TRANSITION_MINUTES));
	}

	captionAt(minute: number): string | null {
		return this.neighbours(minute).current.caption;
	}

	private neighbours(minute: number): { current: Shot; next: Shot; minutesUntilNext: number } {
		const dayMinute = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
		let index = this.shots.length - 1;
		for (let i = 0; i < this.shots.length; i++) if (at(this.shots, i).fromMinute <= dayMinute) index = i;
		const current = at(this.shots, index);
		const isLast = index === this.shots.length - 1;
		const next = at(this.shots, isLast ? 0 : index + 1);
		const nextStart = next.fromMinute + (isLast ? MINUTES_PER_DAY : 0);
		return { current, next, minutesUntilNext: nextStart - dayMinute };
	}
}

export function interpolateView(from: CameraView, to: CameraView, progress: number): CameraView {
	const lerp = (a: number, b: number): number => a + (b - a) * progress;
	return {
		centre: [lerp(from.centre[0], to.centre[0]), lerp(from.centre[1], to.centre[1])],
		spanM: Math.exp(lerp(Math.log(from.spanM), Math.log(to.spanM))),
		pitch: lerp(from.pitch, to.pitch),
		bearing: lerp(from.bearing, to.bearing),
	};
}

/** Smoothstep: starts and ends gently. */
export function easeInOut(progress: number): number {
	const clamped = Math.min(1, Math.max(0, progress));
	return clamped * clamped * (3 - 2 * clamped);
}
