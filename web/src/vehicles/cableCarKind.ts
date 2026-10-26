import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { OverlayProps } from "../map/overlayProps";
import { distanceM, lerpLonLat } from "../render/lonLat";
import type { VehicleState } from "../render/vehicleTimeline";
import { type CableProfile, cableHeightM, HangingFromCable, type MotionModel } from "./motion";
import { Box, type Corner, type Shape } from "./shape";
import { solidColour, solidLayer, solidsOf, type VehicleFrame, type VehicleKind } from "./vehicleKind";

/**
 * The map is flat (no terrain yet), so cables are drawn at a fixed height above it rather
 * than climbing the mountain; the sag still shows which way the span runs.
 */
export const CABLE: CableProfile = { stationHeightM: 60, sagPerSpanM: 0.02, maxSagM: 40 };
/** A large aerial-tramway cabin; gondolas are smaller, but would vanish at this zoom. */
const CABIN = new Box(10, 5, 4);
/** The hanger between the cable and the cabin's roof. */
const HANGER_M = 5;
/** Enough points for the sag to look like a curve. */
const CABLE_POINTS = 24;
const CABLE_WIDTH_M = 0.6;
const CABLE_MIN_WIDTH_PX = 1;

/** A cable between two stations, sagging towards the middle of its span. */
export function cablePath(from: readonly [number, number], to: readonly [number, number]): Corner[] {
	const spanM = distanceM(from, to);
	return Array.from({ length: CABLE_POINTS + 1 }, (_, index): Corner => {
		const t = index / CABLE_POINTS;
		const [longitude, latitude] = lerpLonLat(from, to, t);
		return [longitude, latitude, cableHeightM(CABLE, spanM, t)];
	});
}

/** Cable cars: a cabin hanging from its cable, which is drawn too. */
export class CableCarKind implements VehicleKind {
	readonly layer = "aerial";
	private readonly motion: MotionModel = new HangingFromCable(CABLE, HANGER_M + CABIN.heightM);
	private readonly shape: Shape = CABIN;

	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		return [
			new PathLayer<Corner[], OverlayProps>({
				id: `${frame.idPrefix}-aerial-cables`,
				data: cablesUnder(vehicles),
				getPath: (cable) => cable,
				getColor: [...frame.palette.map.aerialway],
				getWidth: CABLE_WIDTH_M,
				widthUnits: "meters",
				widthMinPixels: CABLE_MIN_WIDTH_PX,
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			}),
			solidLayer(
				`${frame.idPrefix}-aerial-cabins`,
				solidsOf(vehicles, this.motion, this.shape, solidColour(frame.palette, this.layer)),
				frame,
			),
		];
	}
}

/** One cable per span in use; both cabins of a to-and-fro tramway share theirs. */
function cablesUnder(vehicles: readonly VehicleState[]): Corner[][] {
	const cables = new Map<string, Corner[]>();
	for (const { legFrom, legTo } of vehicles) {
		const ends = [legFrom.join(","), legTo.join(",")].sort().join(";");
		if (!cables.has(ends)) cables.set(ends, cablePath(legFrom, legTo));
	}
	return [...cables.values()];
}
