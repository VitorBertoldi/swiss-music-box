import { distanceM, headingDeg, type LonLat } from "../render/lonLat";
import type { VehicleState } from "../render/vehicleTimeline";
import { PathMeasure } from "./pathMeasure";

/** Where one solid part of a vehicle stands (a train car, a hull, a cabin). */
export interface Placement {
	/** Centre of its footprint. */
	readonly centre: LonLat;
	/** The way its front points, degrees clockwise from north. */
	readonly headingDeg: number;
	/** Height of its underside above the map, in metres. */
	readonly baseM: number;
}

/** How a kind of vehicle sits on its route: the parts it consists of, and where they are. */
export interface MotionModel {
	place(vehicle: VehicleState): Placement[];
}

/**
 * A train: cars one behind the other, each turned to follow the curve of the track under it.
 * Cars are laid back from the front for as long as there is body to lay them on, so a train
 * leaving its first station rolls out of it car by car.
 */
export class CarsAlongTrack implements MotionModel {
	constructor(
		private readonly carLengthM: number,
		private readonly gapM: number,
		private readonly carCount: number,
	) {}

	place(vehicle: VehicleState): Placement[] {
		const body = new PathMeasure(vehicle.body);
		const placements: Placement[] = [];
		for (let car = 0; car < this.carCount; car++) {
			const rearOfCarM = body.lengthM - (car + 1) * this.carLengthM - car * this.gapM;
			if (rearOfCarM < 0) break;
			const { point, headingDeg } = body.at(rearOfCarM + this.carLengthM / 2);
			placements.push({ centre: point, headingDeg, baseM: 0 });
		}
		return placements;
	}
}

/** A boat: one hull whose stern trails its bow along the route. */
export class SingleHull implements MotionModel {
	constructor(private readonly lengthM: number) {}

	place(vehicle: VehicleState): Placement[] {
		const body = new PathMeasure(vehicle.body);
		const { point, headingDeg } = body.at(body.lengthM - this.lengthM / 2);
		return [{ centre: point, headingDeg, baseM: 0 }];
	}
}

/** The shape of a cable between two stations: it hangs lowest in the middle of the span. */
export interface CableProfile {
	/** Height of the cable above the map where it leaves a station, in metres. */
	readonly stationHeightM: number;
	/** How far it sags per metre of span, and at most. */
	readonly sagPerSpanM: number;
	readonly maxSagM: number;
}

/** Height of the cable a share `t` (0..1) of the way along a span (a parabola, close to a catenary). */
export function cableHeightM(profile: CableProfile, spanM: number, t: number): number {
	const sagM = Math.min(profile.maxSagM, spanM * profile.sagPerSpanM);
	return profile.stationHeightM - 4 * sagM * t * (1 - t);
}

/** A cabin hanging below the cable, pointing from one station to the other. */
export class HangingFromCable implements MotionModel {
	constructor(
		private readonly cable: CableProfile,
		/** Distance from the cable down to the cabin's roof, plus the cabin's height. */
		private readonly dropBelowCableM: number,
	) {}

	place(vehicle: VehicleState): Placement[] {
		const spanM = distanceM(vehicle.legFrom, vehicle.legTo);
		const t = spanM === 0 ? 0 : Math.min(1, distanceM(vehicle.legFrom, vehicle.head) / spanM);
		return [
			{
				centre: vehicle.head,
				headingDeg: headingDeg(vehicle.legFrom, vehicle.legTo),
				baseM: Math.max(0, cableHeightM(this.cable, spanM, t) - this.dropBelowCableM),
			},
		];
	}
}
