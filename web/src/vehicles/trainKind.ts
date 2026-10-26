import type { Layer } from "@deck.gl/core";
import type { MovingLayer } from "../render/palette";
import { BODY_LENGTH_M, type VehicleState } from "../render/vehicleTimeline";
import { CarsAlongTrack, type MotionModel } from "./motion";
import { Box, type Shape } from "./shape";
import {
	lighter,
	minimumWidthM,
	solidColour,
	solidLayer,
	solidsOf,
	type VehicleFrame,
	type VehicleKind,
} from "./vehicleKind";

/** Gap kept between two cars on screen, so a train reads as cars and not as one bar. */
const MIN_CAR_GAP_PX = 2;
/** The leading car is lit up a little, so you can tell which way a train is going. */
const FRONT_CAR_LIGHTER = 0.45;

/** The size of one car, and the gap between two coupled cars. */
export interface CarSpec {
	readonly lengthM: number;
	readonly widthM: number;
	readonly heightM: number;
	readonly gapM: number;
}

// Approximate sizes of typical Swiss rolling stock.
/** An IC2000 double-deck coach. */
export const INTERCITY_CAR: CarSpec = { lengthM: 26.8, widthM: 2.8, heightM: 4.6, gapM: 0.8 };
/** A double-deck S-Bahn car. */
export const S_BAHN_CAR: CarSpec = { lengthM: 25, widthM: 2.8, heightM: 4.3, gapM: 0.8 };
/** A metre-gauge mountain railway car. */
export const MOUNTAIN_CAR: CarSpec = { lengthM: 15, widthM: 2.65, heightM: 3.6, gapM: 0.6 };
/** A funicular: one long car. */
export const FUNICULAR_CAR: CarSpec = { lengthM: 28, widthM: 3, heightM: 3.5, gapM: 0 };

/** How many cars fit in the length a train of this kind occupies on the track. */
export function carsIn(bodyLengthM: number, car: CarSpec): number {
	return Math.max(1, Math.floor((bodyLengthM + car.gapM) / (car.lengthM + car.gapM)));
}

/** Rail vehicles: a row of cars that bends with the track. Hidden while underground. */
export class TrainKind implements VehicleKind {
	private readonly carCount: number;
	private readonly shape: Shape;

	constructor(
		readonly layer: MovingLayer,
		private readonly car: CarSpec,
	) {
		this.carCount = carsIn(BODY_LENGTH_M[layer], car);
		this.shape = new Box(car.lengthM, car.widthM, car.heightM);
	}

	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		// In a tunnel the train is under the mountain; the tunnel glow shows where it is.
		const aboveGround = vehicles.filter((vehicle) => !vehicle.isInsideTunnel);
		const gapM = Math.max(this.car.gapM, MIN_CAR_GAP_PX * frame.metresPerPixel);
		const motion: MotionModel = new CarsAlongTrack(this.car.lengthM, gapM, this.carCount);
		const shape = this.shape.widened(minimumWidthM(frame));
		const colour = solidColour(frame.palette, this.layer);
		const solids = solidsOf(aboveGround, motion, shape, frame, colour, lighter(colour, FRONT_CAR_LIGHTER));
		return [solidLayer(`${frame.idPrefix}-${this.layer}-cars`, solids, frame)];
	}
}
