import type { Elevation } from "../render/elevation";
import { distanceM, headingDeg, lerpLonLat } from "../render/lonLat";
import type { VehicleState } from "../render/vehicleTimeline";

const DEGREES_PER_RADIAN = 180 / Math.PI;

/** Where one solid part of a vehicle stands (a train car, a hull, a cabin), and how it leans. */
export interface Pose3D {
	/** Longitude, latitude, and the altitude of its underside in metres, as drawn. */
	readonly position: readonly [longitude: number, latitude: number, altitudeM: number];
	/** The way its front points, degrees clockwise from north. */
	readonly yawDeg: number;
	/** Nose up (positive) or down, degrees. */
	readonly pitchDeg: number;
	/** Leaning to the right (positive) or left, degrees. */
	readonly rollDeg: number;
}

/** What a motion model needs besides the vehicle: where the ground is, and the time. */
export interface PoseContext {
	readonly elevation: Elevation;
	/** `performance.now()` of the frame, for movement that isn't in the timetable (a boat rocking). */
	readonly nowMs: number;
}

/** How a kind of vehicle sits on its route: the parts it consists of, and where they are. */
export interface MotionModel {
	/** The parts of one vehicle, its front part first. */
	place(vehicle: VehicleState, context: PoseContext): Pose3D[];
}

/**
 * A train: cars one behind the other along its run. Each car rests on two bogies, so it turns
 * with a curve and tilts with a gradient exactly as the track under it does.
 */
export class CarsAlongTrack implements MotionModel {
	constructor(
		/** Length of the leading vehicle (a locomotive or driving car). */
		private readonly leadLengthM: number,
		/** Length of each car behind it. */
		private readonly carLengthM: number,
		private readonly gapM: number,
		private readonly carCount: number,
		/** Distance between a car's two bogie centres, as a share of its length. */
		private readonly bogieSpacingShare = 0.7,
	) {}

	place(vehicle: VehicleState, { elevation }: PoseContext): Pose3D[] {
		const poses: Pose3D[] = [];
		for (let car = 0; car < this.carCount; car++) {
			const lengthM = car === 0 ? this.leadLengthM : this.carLengthM;
			const frontM =
				car === 0
					? vehicle.headM
					: vehicle.headM - this.leadLengthM - this.gapM - (car - 1) * (this.carLengthM + this.gapM);
			const centreM = frontM - lengthM / 2;
			if (frontM - lengthM < 0) break; // no track left behind the run's start
			const halfSpacingM = (lengthM * this.bogieSpacingShare) / 2;
			const front = vehicle.path.at(centreM + halfSpacingM);
			const rear = vehicle.path.at(centreM - halfSpacingM);
			const [longitude, latitude] = lerpLonLat(rear.point, front.point, 0.5);
			const spacingM = distanceM(rear.point, front.point);
			const climbM = front.heightM - rear.heightM;
			poses.push({
				position: [longitude, latitude, elevation.altitudeM((front.heightM + rear.heightM) / 2)],
				yawDeg: spacingM > 0 ? headingDeg(rear.point, front.point) : front.headingDeg,
				pitchDeg: elevation.isTerrain ? Math.atan2(climbM, spacingM) * DEGREES_PER_RADIAN : 0,
				rollDeg: 0,
			});
		}
		return poses;
	}
}

/** How a boat moves on the water beyond following its route. */
export interface Swell {
	readonly rollDeg: number;
	readonly pitchDeg: number;
	readonly periodMs: number;
}

/** A boat: one hull whose stern trails its bow along the route, rocking gently on the swell. */
export class HullOnWater implements MotionModel {
	constructor(
		private readonly lengthM: number,
		private readonly swell: Swell,
	) {}

	place(vehicle: VehicleState, { elevation, nowMs }: PoseContext): Pose3D[] {
		const { point, heightM, headingDeg: yaw } = vehicle.path.at(vehicle.headM - this.lengthM / 2);
		// Each boat rocks in its own phase, so a fleet at the pier doesn't move in step.
		const phase = (2 * Math.PI * nowMs) / this.swell.periodMs + vehicle.trip;
		return [
			{
				position: [point[0], point[1], elevation.altitudeM(heightM)],
				yawDeg: yaw,
				pitchDeg: this.swell.pitchDeg * Math.sin(phase * 0.7),
				rollDeg: this.swell.rollDeg * Math.sin(phase),
			},
		];
	}
}

/** The shape of a rope between two stations: it hangs lowest in the middle of the span. */
export interface CableProfile {
	/** Height of the rope above each station's ground, where it leaves the station, in metres. */
	readonly stationHeightM: number;
	/** How far it sags per metre of span, and at most. */
	readonly sagPerSpanM: number;
	readonly maxSagM: number;
}

/**
 * Altitude of the rope a share `t` (0..1) of the way along a span, between stations drawn at
 * `fromAltitudeM` and `toAltitudeM` (a parabola, close to a real catenary).
 */
export function cableHeightM(
	profile: CableProfile,
	spanM: number,
	t: number,
	fromAltitudeM = 0,
	toAltitudeM = 0,
): number {
	const sagM = Math.min(profile.maxSagM, spanM * profile.sagPerSpanM);
	return fromAltitudeM + (toAltitudeM - fromAltitudeM) * t + profile.stationHeightM - 4 * sagM * t * (1 - t);
}

/** A cabin (or gondola, or chair) hanging below its rope, pointing along the span, upright. */
export class HangingFromCable implements MotionModel {
	constructor(
		private readonly cable: CableProfile,
		/** Distance from the rope down to the cabin's floor. */
		private readonly dropBelowCableM: number,
	) {}

	place(vehicle: VehicleState, { elevation }: PoseContext): Pose3D[] {
		const from = vehicle.path.at(vehicle.legStartM);
		const to = vehicle.path.at(vehicle.legEndM);
		const head = vehicle.path.at(vehicle.headM);
		const spanM = distanceM(from.point, to.point);
		const t = spanM === 0 ? 0 : Math.min(1, distanceM(from.point, head.point) / spanM);
		// On the terrain a cable car's path heights are its rope's, over the pylons; the flat
		// map has no ground to measure from, so it draws one sagging span between the stations.
		const ropeM = elevation.isTerrain ? elevation.altitudeM(head.heightM) : cableHeightM(this.cable, spanM, t);
		return [
			{
				position: [head.point[0], head.point[1], ropeM - this.dropBelowCableM],
				yawDeg: headingDeg(from.point, to.point),
				pitchDeg: 0,
				rollDeg: 0,
			},
		];
	}
}
