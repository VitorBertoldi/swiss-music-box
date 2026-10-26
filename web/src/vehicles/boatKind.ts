import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { OverlayProps } from "../map/overlayProps";
import type { Rgba } from "../render/palette";
import { type ColouredPath, fadingTrails } from "../render/preciseVehicleLayers";
import type { VehicleState } from "../render/vehicleTimeline";
import { lakeShip } from "./models/catalogue";
import { BoxModel, LevelOfDetail, MeshModel } from "./models/vehicleModel";
import { HullOnWater, type MotionModel, type Swell } from "./motion";
import { Hull } from "./shape";
import { solidColour, type VehicleFrame, type VehicleKind } from "./vehicleKind";

const SHIP = lakeShip();
/** The foam behind a boat spreads wider than the boat itself. */
const WAKE_WIDTH_M = 16;
const WAKE_COLOUR: Rgba = [235, 245, 255, 110];
/** A calm lake: a few degrees of roll, slower than a breath. */
const LAKE_SWELL: Swell = { rollDeg: 2.5, pitchDeg: 1, periodMs: 5200 };
/** The hull alone, for boats seen from afar. */
const HULL_HEIGHT_M = 5;

/** Boats: a ship pointing where it sails, rocking on the lake, with a fading wake behind it. */
export class BoatKind implements VehicleKind {
	readonly layer = "boat";
	private readonly motion: MotionModel = new HullOnWater(SHIP.lengthM, LAKE_SWELL);
	private readonly ship = new LevelOfDetail(
		new MeshModel(SHIP),
		new BoxModel(new Hull(SHIP.lengthM, SHIP.widthM, HULL_HEIGHT_M)),
	);

	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		const poses = vehicles.flatMap((vehicle) => this.motion.place(vehicle, frame));
		return [
			new PathLayer<ColouredPath, OverlayProps>({
				id: `${frame.idPrefix}-boat-wakes`,
				data: fadingTrails(vehicles, frame.elevation, () => WAKE_COLOUR),
				getPath: (wake) => wake.path,
				getColor: (wake) => wake.colours,
				getWidth: WAKE_WIDTH_M,
				widthUnits: "meters",
				capRounded: true,
				jointRounded: true,
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			}),
			...this.ship
				.choose(frame)
				.model.layers(`${frame.idPrefix}-boat`, poses, solidColour(frame.palette, this.layer), frame),
		];
	}
}
