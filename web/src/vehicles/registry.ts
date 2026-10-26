import type { Layer } from "@deck.gl/core";
import type { MovingLayer } from "../render/palette";
import type { VehicleState } from "../render/vehicleTimeline";
import { BoatKind } from "./boatKind";
import { CableCarKind } from "./cableCarKind";
import { FUNICULAR_CAR, INTERCITY_CAR, MOUNTAIN_CAR, S_BAHN_CAR, TrainKind } from "./trainKind";
import type { VehicleFrame, VehicleKind } from "./vehicleKind";

export const MOVING_LAYERS: readonly MovingLayer[] = [
	"long_rail",
	"regional_rail",
	"mountain_rail",
	"funicular",
	"boat",
	"aerial",
];

/** The kinds the player uses: one per moving layer. */
export function standardVehicleKinds(): VehicleKind[] {
	return [
		new TrainKind("long_rail", INTERCITY_CAR),
		new TrainKind("regional_rail", S_BAHN_CAR),
		new TrainKind("mountain_rail", MOUNTAIN_CAR),
		new TrainKind("funicular", FUNICULAR_CAR),
		new BoatKind(),
		new CableCarKind(),
	];
}

/** The one place that knows which kind draws which layer; every moving layer must have one. */
export class VehicleKindRegistry {
	private readonly kinds = new Map<MovingLayer, VehicleKind>();

	constructor(kinds: readonly VehicleKind[]) {
		for (const kind of kinds) {
			if (this.kinds.has(kind.layer)) throw new Error(`two vehicle kinds for "${kind.layer}"`);
			this.kinds.set(kind.layer, kind);
		}
		const missing = MOVING_LAYERS.filter((layer) => !this.kinds.has(layer));
		if (missing.length > 0) throw new Error(`no vehicle kind for ${missing.join(", ")}`);
	}

	/** Every vehicle drawn by its own kind. Each kind always gets a call, so layer ids stay stable. */
	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		const byLayer = new Map<MovingLayer, VehicleState[]>(MOVING_LAYERS.map((layer) => [layer, []]));
		for (const vehicle of vehicles) byLayer.get(vehicle.layer)?.push(vehicle);
		return [...this.kinds.values()].flatMap((kind) => kind.draw(byLayer.get(kind.layer) ?? [], frame));
	}
}
