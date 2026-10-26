import type { Layer } from "@deck.gl/core";
import type { MovingLayer } from "../render/palette";
import { BODY_LENGTH_M, type VehicleState } from "../render/vehicleTimeline";
import {
	funicularCar,
	intercityCoach,
	type ModelParts,
	mountainCar,
	re460Locomotive,
	sBahnCabCar,
	sBahnCar,
} from "./models/catalogue";
import { BoxModel, LevelOfDetail, MeshModel } from "./models/vehicleModel";
import { CarsAlongTrack, type Pose3D } from "./motion";
import { Box } from "./shape";
import { lighter, solidColour, type VehicleFrame, type VehicleKind } from "./vehicleKind";

/** Gap kept between two cars on screen, so a train reads as cars and not as one bar. */
const MIN_CAR_GAP_PX = 2;
/** From afar the leading car is lit up a little, so you can tell which way a train is going. */
const FRONT_CAR_LIGHTER = 0.45;

/** What a train is made of: its leading vehicle, the cars behind it, and the gap between them. */
export interface TrainSpec {
	readonly lead: ModelParts;
	readonly car: ModelParts;
	readonly gapM: number;
}

/** An SBB IC: an Re 460 locomotive pulling IC2000 double-deck coaches. */
export const INTERCITY: TrainSpec = { lead: re460Locomotive(), car: intercityCoach(), gapM: 0.8 };
/** A double-deck S-Bahn with a driving car at the front. */
export const S_BAHN: TrainSpec = { lead: sBahnCabCar(), car: sBahnCar(), gapM: 0.8 };
/** A metre-gauge mountain train. */
export const MOUNTAIN_TRAIN: TrainSpec = { lead: mountainCar(), car: mountainCar(), gapM: 0.6 };
/** A funicular: one long car. */
export const FUNICULAR: TrainSpec = { lead: funicularCar(), car: funicularCar(), gapM: 0 };

/** How many vehicles fit in the length a train of this kind occupies on the track. */
export function carsIn(bodyLengthM: number, train: TrainSpec): number {
	const behindLeadM = bodyLengthM - train.lead.lengthM;
	return 1 + Math.max(0, Math.floor(behindLeadM / (train.car.lengthM + train.gapM)));
}

/** Rail vehicles: a lead vehicle and cars that bend and tilt with the track. Hidden underground. */
export class TrainKind implements VehicleKind {
	private readonly carCount: number;
	private readonly lead: LevelOfDetail;
	private readonly cars: LevelOfDetail;

	constructor(
		readonly layer: MovingLayer,
		private readonly train: TrainSpec,
	) {
		this.carCount = carsIn(BODY_LENGTH_M[layer], train);
		this.lead = new LevelOfDetail(new MeshModel(train.lead), new BoxModel(boxOf(train.lead)));
		this.cars = new LevelOfDetail(new MeshModel(train.car), new BoxModel(boxOf(train.car)));
	}

	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		// In a tunnel the train is under the mountain; the tunnel glow shows where it is.
		const aboveGround = vehicles.filter((vehicle) => !vehicle.isInsideTunnel);
		const gapM = Math.max(this.train.gapM, MIN_CAR_GAP_PX * frame.metresPerPixel);
		const motion = new CarsAlongTrack(this.train.lead.lengthM, this.train.car.lengthM, gapM, this.carCount);
		const leadPoses: Pose3D[] = [];
		const carPoses: Pose3D[] = [];
		for (const vehicle of aboveGround) {
			const [lead, ...cars] = motion.place(vehicle, frame);
			if (lead !== undefined) leadPoses.push(lead);
			carPoses.push(...cars);
		}
		const colour = solidColour(frame.palette, this.layer);
		const lead = this.lead.choose(frame);
		const cars = this.cars.choose(frame);
		const id = `${frame.idPrefix}-${this.layer}`;
		return [
			...lead.model.layers(
				`${id}-lead`,
				leadPoses,
				lead.isDetailed ? colour : lighter(colour, FRONT_CAR_LIGHTER),
				frame,
			),
			...cars.model.layers(`${id}-cars`, carPoses, colour, frame),
		];
	}
}

function boxOf(parts: ModelParts): Box {
	return new Box(parts.lengthM, parts.widthM, parts.heightM);
}
