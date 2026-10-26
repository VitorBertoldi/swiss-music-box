import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { OverlayProps } from "../map/overlayProps";
import type { Elevation, LonLatHeight } from "../render/elevation";
import { distanceM, type LonLat, lerpLonLat } from "../render/lonLat";
import type { VehicleState } from "../render/vehicleTimeline";
import { CABIN_ROPE_HEIGHT_M, tramwayCabin } from "./models/catalogue";
import { BoxModel, LevelOfDetail, MeshModel } from "./models/vehicleModel";
import { type CableProfile, cableHeightM, HangingFromCable, type MotionModel } from "./motion";
import { Box, type Corner } from "./shape";
import { solidColour, type VehicleFrame, type VehicleKind } from "./vehicleKind";

/**
 * The map is flat (no terrain yet), so cables are drawn at a fixed height above it rather
 * than climbing the mountain; the sag still shows which way the span runs.
 */
export const CABLE: CableProfile = { stationHeightM: 60, sagPerSpanM: 0.02, maxSagM: 40 };
/** A large aerial-tramway cabin; gondolas are smaller, but would vanish at this zoom. */
const CABIN = tramwayCabin();
/** Enough points for the sag to look like a curve. */
const CABLE_POINTS = 24;
const CABLE_WIDTH_M = 0.6;
const CABLE_MIN_WIDTH_PX = 1;

/** A rope between two stations at their drawn altitudes, sagging towards the middle of its span. */
export function cablePath(from: LonLatHeight, to: LonLatHeight, elevation: Elevation): Corner[] {
	const fromLonLat: LonLat = [from[0], from[1]];
	const toLonLat: LonLat = [to[0], to[1]];
	const spanM = distanceM(fromLonLat, toLonLat);
	const fromAltitudeM = elevation.altitudeM(from[2]);
	const toAltitudeM = elevation.altitudeM(to[2]);
	return Array.from({ length: CABLE_POINTS + 1 }, (_, index): Corner => {
		const t = index / CABLE_POINTS;
		const [longitude, latitude] = lerpLonLat(fromLonLat, toLonLat, t);
		return [longitude, latitude, cableHeightM(CABLE, spanM, t, fromAltitudeM, toAltitudeM)];
	});
}

/** Cable cars: a cabin hanging from its cable, which is drawn too. */
export class CableCarKind implements VehicleKind {
	readonly layer = "aerial";
	private readonly motion: MotionModel = new HangingFromCable(CABLE, CABIN_ROPE_HEIGHT_M);
	private readonly cabin = new LevelOfDetail(
		new MeshModel(CABIN),
		new BoxModel(new Box(CABIN.lengthM, CABIN.widthM, CABIN.heightM)),
	);

	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		return [
			new PathLayer<Corner[], OverlayProps>({
				id: `${frame.idPrefix}-aerial-cables`,
				data: cablesUnder(vehicles, frame.elevation),
				getPath: (cable) => cable,
				getColor: [...frame.palette.map.aerialway],
				getWidth: CABLE_WIDTH_M,
				widthUnits: "meters",
				widthMinPixels: CABLE_MIN_WIDTH_PX,
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			}),
			...this.cabin.choose(frame).model.layers(
				`${frame.idPrefix}-aerial-cabins`,
				vehicles.flatMap((vehicle) => this.motion.place(vehicle, frame)),
				solidColour(frame.palette, this.layer),
				frame,
			),
		];
	}
}

/** One rope per span in use; both cabins of a to-and-fro tramway share theirs. */
function cablesUnder(vehicles: readonly VehicleState[], elevation: Elevation): Corner[][] {
	const cables = new Map<string, Corner[]>();
	for (const vehicle of vehicles) {
		const [from] = vehicle.path.stretchWithHeights(vehicle.legStartM, vehicle.legStartM);
		const [to] = vehicle.path.stretchWithHeights(vehicle.legEndM, vehicle.legEndM);
		if (from === undefined || to === undefined) continue;
		const ends = [from.join(","), to.join(",")].sort().join(";");
		if (!cables.has(ends)) cables.set(ends, cablePath(from, to, elevation));
	}
	return [...cables.values()];
}
