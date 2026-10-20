import { distanceM, type LonLat } from "../render/lonLat";
import type { MovingLayer } from "../render/palette";
import type { VehicleTimeline } from "../render/vehicleTimeline";
import type { CameraContext, CameraMode, CameraView } from "./camera";

/** Close enough to see the train's length and the streets around it. */
const FOLLOW_SPAN_M = 2_500;
const FOLLOW_PITCH = 55;
const CAPTIONS: Readonly<Record<MovingLayer, string>> = {
	long_rail: "Following an IC / IR train",
	regional_rail: "Following an S-Bahn",
	mountain_rail: "Following a mountain train",
	funicular: "Following a funicular",
	aerial: "Following a cable car",
	boat: "Following a boat",
};

/**
 * Rides along with one vehicle. It picks the moving vehicle of the preferred kind nearest to
 * where the camera is, and when that trip ends, picks the next one nearby.
 */
export class FollowCamera implements CameraMode {
	readonly id = "follow";
	private followedTrip: number | null = null;
	private followedLayer: MovingLayer;

	constructor(
		private readonly timeline: VehicleTimeline,
		private readonly preferredLayers: readonly MovingLayer[] = ["long_rail", "regional_rail"],
	) {
		this.followedLayer = preferredLayers[0] ?? "long_rail";
	}

	viewAt(context: CameraContext): CameraView | null {
		let position = this.followedTrip === null ? null : this.timeline.positionOfTrip(this.followedTrip, context.minute);
		if (position === null) position = this.pickNearest(context);
		if (position === null) return null;
		return { centre: position, spanM: FOLLOW_SPAN_M, pitch: FOLLOW_PITCH, bearing: context.current.bearing };
	}

	captionAt(): string | null {
		return this.followedTrip === null ? null : CAPTIONS[this.followedLayer];
	}

	/** Starts over with the vehicle nearest to the camera, e.g. when the mode is switched on. */
	reset(): void {
		this.followedTrip = null;
	}

	private pickNearest(context: CameraContext): LonLat | null {
		const vehicles = this.timeline.vehiclesAt(context.minute);
		for (const layer of this.preferredLayers) {
			const candidates = vehicles.filter((vehicle) => vehicle.layer === layer && !vehicle.isInsideTunnel);
			let nearest = candidates[0];
			for (const candidate of candidates) {
				if (
					distanceM(candidate.head, context.current.centre) <
					distanceM(nearest?.head ?? candidate.head, context.current.centre)
				) {
					nearest = candidate;
				}
			}
			if (nearest !== undefined) {
				this.followedTrip = nearest.trip;
				this.followedLayer = nearest.layer;
				return nearest.head;
			}
		}
		this.followedTrip = null;
		return null;
	}
}
