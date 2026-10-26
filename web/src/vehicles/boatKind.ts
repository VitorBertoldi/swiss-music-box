import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { OverlayProps } from "../map/overlayProps";
import type { LonLat } from "../render/lonLat";
import type { Rgba } from "../render/palette";
import { fadingColours } from "../render/preciseVehicleLayers";
import { BODY_LENGTH_M, type VehicleState } from "../render/vehicleTimeline";
import { type MotionModel, SingleHull } from "./motion";
import { Hull, type Shape } from "./shape";
import { minimumWidthM, solidColour, solidLayer, solidsOf, type VehicleFrame, type VehicleKind } from "./vehicleKind";

/** A lake steamer or motor ship of the Swiss lake fleets, roughly. */
const HULL = new Hull(BODY_LENGTH_M.boat, 11, 5);
/** The foam behind a boat spreads wider than the boat itself. */
const WAKE_WIDTH_M = 16;
const WAKE_COLOUR: Rgba = [235, 245, 255, 110];

/** Boats: a hull pointing where it sails, with a fading wake on the water behind it. */
export class BoatKind implements VehicleKind {
	readonly layer = "boat";
	private readonly motion: MotionModel = new SingleHull(HULL.lengthM);
	private readonly shape: Shape = HULL;

	draw(vehicles: readonly VehicleState[], frame: VehicleFrame): Layer[] {
		return [
			new PathLayer<VehicleState, OverlayProps>({
				id: `${frame.idPrefix}-boat-wakes`,
				data: vehicles,
				getPath: (vehicle) => vehicle.tail as LonLat[],
				getColor: (vehicle) => fadingColours(WAKE_COLOUR, vehicle.tail.length),
				getWidth: WAKE_WIDTH_M,
				widthUnits: "meters",
				capRounded: true,
				jointRounded: true,
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			}),
			solidLayer(
				`${frame.idPrefix}-boat-hulls`,
				solidsOf(
					vehicles,
					this.motion,
					this.shape.widened(minimumWidthM(frame)),
					solidColour(frame.palette, this.layer),
				),
				frame,
			),
		];
	}
}
