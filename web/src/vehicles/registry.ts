import type { Layer } from "@deck.gl/core";
import type { Pylon } from "../contract/motion";
import type { LonLatBox } from "../map/mapView";
import type { LonLat } from "../render/lonLat";
import type { MovingLayer } from "../render/palette";
import type { VehicleState } from "../render/vehicleTimeline";
import { BoatKind } from "./boatKind";
import { CableCarKind } from "./cableCarKind";
import { FUNICULAR, INTERCITY, MOUNTAIN_TRAIN, S_BAHN, TrainKind } from "./trainKind";
import type { VehicleFrame, VehicleKind } from "./vehicleKind";

export const MOVING_LAYERS: readonly MovingLayer[] = [
	"long_rail",
	"regional_rail",
	"mountain_rail",
	"funicular",
	"boat",
	"aerial",
];

/** The kinds the player uses: one per moving layer. Cable cars also draw their `pylons`. */
export function standardVehicleKinds(pylons: readonly Pylon[]): VehicleKind[] {
	return [
		new TrainKind("long_rail", INTERCITY),
		new TrainKind("regional_rail", S_BAHN),
		new TrainKind("mountain_rail", MOUNTAIN_TRAIN),
		new TrainKind("funicular", FUNICULAR),
		new BoatKind(),
		new CableCarKind(pylons),
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

	/**
	 * Every vehicle in view drawn by its own kind; the rest aren't posed at all. Each kind always
	 * gets a call, so layer ids stay stable.
	 */
	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		const byLayer = new Map<MovingLayer, VehicleState[]>(MOVING_LAYERS.map((layer) => [layer, []]));
		for (const vehicle of vehicles) {
			if (isInside(vehicle.head, frame.visibleArea)) byLayer.get(vehicle.layer)?.push(vehicle);
		}
		return [...this.kinds.values()].flatMap((kind) => kind.draw(byLayer.get(kind.layer) ?? [], frame));
	}
}

function isInside([longitude, latitude]: LonLat, [west, south, east, north]: LonLatBox): boolean {
	return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}
