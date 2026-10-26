import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { Pylon } from "../contract/motion";
import type { LonLatBox } from "../map/mapView";
import type { OverlayProps } from "../map/overlayProps";
import { type Elevation, type LonLatHeight, placed } from "../render/elevation";
import { distanceM, type LonLat, lerpLonLat } from "../render/lonLat";
import type { Ropeway, VehicleState } from "../render/vehicleTimeline";
import {
	CABIN_ROPE_HEIGHT_M,
	CHAIR_ROPE_HEIGHT_M,
	GONDOLA_ROPE_HEIGHT_M,
	gondolaCabin,
	liftChair,
	type ModelParts,
	pylonTower,
	tramwayCabin,
} from "./models/catalogue";
import type { MeshData } from "./models/meshBuilder";
import { BoxModel, LevelOfDetail, MeshModel } from "./models/vehicleModel";
import { type CableProfile, cableHeightM, HangingFromCable, type MotionModel, type Pose3D } from "./motion";
import { Box, type Corner } from "./shape";
import { SOLID_MATERIAL, solidColour, type VehicleFrame, type VehicleKind } from "./vehicleKind";

/**
 * On the flat map there is no ground to hang a rope from, so ropes are drawn at a fixed height
 * above it; the sag still shows which way the span runs. On the terrain the rope comes from
 * the pipeline, over the tops of OpenStreetMap's pylons.
 */
export const CABLE: CableProfile = { stationHeightM: 60, sagPerSpanM: 0.02, maxSagM: 40 };
/** Enough points for the sag to look like a curve. */
const CABLE_POINTS = 24;
const CABLE_WIDTH_M = 0.6;
const CABLE_MIN_WIDTH_PX = 1;
const DECIMETRES_PER_METRE = 10;
const PYLON_COLOUR: [number, number, number, number] = [175, 180, 188, 255];

/** One kind of thing hanging from a rope: its model and how far below the rope it hangs. */
class Carrier {
	readonly motion: MotionModel;
	readonly model: LevelOfDetail;

	constructor(parts: ModelParts, ropeHeightM: number) {
		this.motion = new HangingFromCable(CABLE, ropeHeightM);
		this.model = new LevelOfDetail(
			new MeshModel(parts),
			new BoxModel(new Box(parts.lengthM, parts.widthM, Math.min(parts.heightM, ropeHeightM))),
		);
	}
}

/** Cable cars: cabins, gondolas or chairs, each on its rope, which is drawn too, with its pylons. */
export class CableCarKind implements VehicleKind {
	readonly layer = "aerial";
	private readonly carriers: Readonly<Record<Ropeway, Carrier>> = {
		cable_car: new Carrier(tramwayCabin(), CABIN_ROPE_HEIGHT_M),
		gondola: new Carrier(gondolaCabin(), GONDOLA_ROPE_HEIGHT_M),
		chair_lift: new Carrier(liftChair(), CHAIR_ROPE_HEIGHT_M),
	};
	private readonly pylonMesh = { attributes: meshAttributes(pylonTower()) };

	constructor(private readonly pylons: readonly Pylon[]) {}

	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		const tint = solidColour(frame.palette, this.layer);
		const carried = (Object.entries(this.carriers) as [Ropeway, Carrier][]).flatMap(([ropeway, carrier]) => {
			// A cable car without an OSM rope gets the large cabin, as most such lines are.
			const riding = vehicles.filter((vehicle) => (vehicle.ropeway ?? "cable_car") === ropeway);
			const poses: Pose3D[] = riding.flatMap((vehicle) => carrier.motion.place(vehicle, frame));
			return carrier.model.choose(frame).model.layers(`${frame.idPrefix}-aerial-${ropeway}`, poses, tint, frame);
		});
		return [
			new PathLayer<Corner[], OverlayProps>({
				id: `${frame.idPrefix}-aerial-cables`,
				data: ropesUnder(vehicles, frame.elevation),
				getPath: (cable) => cable,
				getColor: [...frame.palette.map.aerialway],
				getWidth: CABLE_WIDTH_M,
				widthUnits: "meters",
				widthMinPixels: CABLE_MIN_WIDTH_PX,
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			}),
			new SimpleMeshLayer<Pylon, OverlayProps>({
				id: `${frame.idPrefix}-aerial-pylons`,
				// Pylons stand on the ground, so only the 3D terrain has them.
				data: frame.elevation.isTerrain ? pylonsIn(this.pylons, frame.visibleArea) : [],
				mesh: this.pylonMesh,
				getPosition: (pylon) => [pylon.longitude, pylon.latitude, pylon.base_dm / DECIMETRES_PER_METRE],
				getScale: (pylon) => [1, 1, (pylon.top_dm - pylon.base_dm) / DECIMETRES_PER_METRE],
				getColor: PYLON_COLOUR,
				material: SOLID_MATERIAL,
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			}),
			...carried,
		];
	}
}

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

/** One rope per span in use; both cabins of a to-and-fro tramway share theirs. */
function ropesUnder(vehicles: readonly VehicleState[], elevation: Elevation): Corner[][] {
	const ropes = new Map<string, Corner[]>();
	for (const vehicle of vehicles) {
		const rope = vehicle.path.stretchWithHeights(vehicle.legStartM, vehicle.legEndM);
		const [from, to] = [rope[0], rope.at(-1)];
		if (from === undefined || to === undefined) continue;
		const ends = [from.join(","), to.join(",")].sort().join(";");
		if (ropes.has(ends)) continue;
		// On the terrain the path's heights are the rope's, pylon by pylon.
		ropes.set(
			ends,
			elevation.isTerrain ? rope.map((point) => placed(elevation, point)) : cablePath(from, to, elevation),
		);
	}
	return [...ropes.values()];
}

function pylonsIn(pylons: readonly Pylon[], [west, south, east, north]: LonLatBox): Pylon[] {
	return pylons.filter(
		(pylon) => pylon.longitude >= west && pylon.longitude <= east && pylon.latitude >= south && pylon.latitude <= north,
	);
}

function meshAttributes(mesh: MeshData) {
	return {
		positions: { value: mesh.positions, size: 3 },
		normals: { value: mesh.normals, size: 3 },
		colors: { value: mesh.colors, size: 3 },
	};
}
