/**
 * The vehicles, modelled in code at their real size (approximate dimensions of typical Swiss
 * rolling stock and lake ships). Each model has a tinted part, which takes the vehicle's
 * palette colour (so the IC stays red on screen and projector alike), and a fixed part with its
 * own colours: white bodies, dark glass, grey roofs and running gear.
 *
 * To replace one with a Blender model, export it as glTF in the same frame (metres, x forward,
 * y left, z up, origin under its middle) and use `GltfModel` instead.
 */
import { MeshBuilder, type MeshData, type Point2, type Rgb } from "./meshBuilder";

/** A vehicle's mesh in two parts, and the size it was modelled at. */
export interface ModelParts {
	readonly tinted: MeshData;
	readonly fixed: MeshData;
	readonly lengthM: number;
	readonly widthM: number;
	readonly heightM: number;
}

const TINT: Rgb = [1, 1, 1];
const WHITE: Rgb = [0.92, 0.93, 0.94];
const GLASS: Rgb = [0.09, 0.12, 0.17];
const ROOF: Rgb = [0.58, 0.6, 0.63];
const RUNNING_GEAR: Rgb = [0.15, 0.16, 0.18];
/** Glass and stripes stand this far proud of the body, so they aren't hidden inside it. */
const PROUD_M = 0.03;

function model(
	lengthM: number,
	widthM: number,
	heightM: number,
	shape: (tinted: MeshBuilder, fixed: MeshBuilder) => void,
): ModelParts {
	const tinted = new MeshBuilder();
	const fixed = new MeshBuilder();
	shape(tinted, fixed);
	return { tinted: tinted.build(), fixed: fixed.build(), lengthM, widthM, heightM };
}

/** Two bogies under a car whose bogie centres are `spacingM` apart. */
function bogies(fixed: MeshBuilder, spacingM: number, widthM: number, heightM: number): void {
	const half = spacingM / 2;
	const y = widthM / 2 - 0.2;
	fixed.box([-half - 1.6, -y, 0], [-half + 1.6, y, heightM], RUNNING_GEAR);
	fixed.box([half - 1.6, -y, 0], [half + 1.6, y, heightM], RUNNING_GEAR);
}

/** A band of windows along both sides, from `fromX` to `toX`. */
function windows(
	fixed: MeshBuilder,
	fromX: number,
	toX: number,
	halfWidthM: number,
	bottomZ: number,
	topZ: number,
): void {
	fixed.box([fromX, -halfWidthM - PROUD_M, bottomZ], [toX, halfWidthM + PROUD_M, topZ], GLASS);
}

/** An SBB IC2000 double-deck coach: white, two rows of windows, a red band along the bottom. */
export function intercityCoach(): ModelParts {
	const [length, width, height] = [26.8, 2.8, 4.6];
	const [hl, hw] = [length / 2, width / 2];
	return model(length, width, height, (tinted, fixed) => {
		bogies(fixed, 18.8, width, 1.0);
		fixed.box([-hl, -hw, 1.0], [hl, hw, 4.3], WHITE);
		windows(fixed, -hl + 1.4, hl - 1.4, hw, 1.7, 2.4);
		windows(fixed, -hl + 1.4, hl - 1.4, hw, 3.0, 3.7);
		tinted.box([-hl - PROUD_M, -hw - PROUD_M, 1.0], [hl + PROUD_M, hw + PROUD_M, 1.45], TINT);
		fixed.box([-hl + 0.4, -hw + 0.2, 4.3], [hl - 0.4, hw - 0.2, height], ROOF);
	});
}

/** An SBB Re 460 locomotive: red, with its sloped nose and windscreen facing forward. */
export function re460Locomotive(): ModelParts {
	const [length, width, height] = [18.5, 3.0, 4.3];
	const [hl, hw] = [length / 2, width / 2];
	const noseStartX = hl - 2.05;
	const nose: Point2[] = [
		[noseStartX, 1.0],
		[hl, 1.0],
		[hl, 2.1],
		[hl - 0.95, 3.75],
		[noseStartX, 3.9],
	];
	// The windscreen lies on the nose's slope, from (hl, 2.1) up to (hl - 0.95, 3.75).
	const windscreen: Point2[] = [
		[hl - 0.19, 2.43],
		[hl - 0.155, 2.45],
		[hl - 0.775, 3.52],
		[hl - 0.81, 3.5],
	];
	return model(length, width, height, (tinted, fixed) => {
		bogies(fixed, 10, width, 1.0);
		tinted.box([-hl, -hw, 1.0], [noseStartX, hw, 3.9], TINT);
		tinted.sideProfile(nose, -hw, hw, TINT);
		fixed.sideProfile(windscreen, -hw + 0.15, hw - 0.15, GLASS);
		windows(fixed, noseStartX - 1.0, noseStartX - 0.1, hw, 2.6, 3.4);
		windows(fixed, -hl + 0.3, -hl + 1.2, hw, 2.6, 3.4);
		// The red body runs up to the roof; only the pantographs and roof equipment are grey.
		fixed.box([-6, -0.7, 3.9], [-3, 0.7, height], ROOF);
		fixed.box([2, -0.7, 3.9], [5, 0.7, height], ROOF);
		fixed.box([-1.5, -0.5, 3.9], [0.5, 0.5, 4.1], ROOF);
	});
}

/** A double-deck S-Bahn car: white upper body, the line's colour below, rows of windows. */
export function sBahnCar(): ModelParts {
	return sBahn(false);
}

/** The S-Bahn's driving car, with a sloped cab at the front. */
export function sBahnCabCar(): ModelParts {
	return sBahn(true);
}

function sBahn(withCab: boolean): ModelParts {
	const [length, width, height] = [25, 2.8, 4.3];
	const [hl, hw] = [length / 2, width / 2];
	const bodyEndX = withCab ? hl - 2.2 : hl;
	return model(length, width, height, (tinted, fixed) => {
		bogies(fixed, 17.5, width, 1.0);
		fixed.box([-hl, -hw, 2.0], [bodyEndX, hw, 4.0], WHITE);
		tinted.box([-hl, -hw, 1.0], [bodyEndX, hw, 2.0], TINT);
		windows(fixed, -hl + 1.2, bodyEndX - 0.8, hw, 1.4, 1.95);
		windows(fixed, -hl + 1.2, bodyEndX - 0.8, hw, 2.7, 3.5);
		fixed.box([-hl + 0.4, -hw + 0.2, 4.0], [bodyEndX - 0.2, hw - 0.2, height], ROOF);
		if (withCab) {
			tinted.sideProfile(
				[
					[bodyEndX, 1.0],
					[hl, 1.0],
					[hl, 2.0],
					[bodyEndX, 2.0],
				],
				-hw,
				hw,
				TINT,
			);
			fixed.sideProfile(
				[
					[bodyEndX, 2.0],
					[hl, 2.0],
					[hl - 1.0, 3.6],
					[bodyEndX, 4.0],
				],
				-hw,
				hw,
				WHITE,
			);
			fixed.sideProfile(
				[
					[hl + 0.03, 2.25],
					[hl - 0.85, 3.6],
					[hl - 0.95, 3.55],
					[hl - 0.05, 2.2],
				],
				-hw + 0.2,
				hw - 0.2,
				GLASS,
			);
		}
	});
}

/** A metre-gauge mountain railway car, in the line's colour, with a band of windows. */
export function mountainCar(): ModelParts {
	const [length, width, height] = [15, 2.65, 3.6];
	const [hl, hw] = [length / 2, width / 2];
	return model(length, width, height, (tinted, fixed) => {
		bogies(fixed, 10, width, 0.8);
		tinted.box([-hl, -hw, 0.8], [hl, hw, 3.15], TINT);
		windows(fixed, -hl + 0.8, hl - 0.8, hw, 1.75, 2.55);
		fixed.box([hl - 0.02, -hw + 0.35, 1.75], [hl + PROUD_M, hw - 0.35, 2.55], GLASS);
		fixed.box([-hl + 0.3, -hw + 0.15, 3.15], [hl - 0.3, hw - 0.15, height], ROOF);
	});
}

/** A funicular car: one long body, glazed all round, tilting with the slope. */
export function funicularCar(): ModelParts {
	const [length, width, height] = [28, 3, 3.5];
	const [hl, hw] = [length / 2, width / 2];
	return model(length, width, height, (tinted, fixed) => {
		fixed.box([-hl + 2, -hw + 0.3, 0], [hl - 2, hw - 0.3, 0.5], RUNNING_GEAR);
		tinted.box([-hl, -hw, 0.5], [hl, hw, 3.0], TINT);
		windows(fixed, -hl + 0.6, hl - 0.6, hw, 1.4, 2.5);
		fixed.box([hl - 0.02, -hw + 0.3, 1.4], [hl + PROUD_M, hw - 0.3, 2.5], GLASS);
		fixed.box([-hl - PROUD_M, -hw + 0.3, 1.4], [-hl + 0.02, hw - 0.3, 2.5], GLASS);
		fixed.box([-hl + 0.4, -hw + 0.2, 3.0], [hl - 0.4, hw - 0.2, height], ROOF);
	});
}

/** A lake ship: hull in the fleet's colour, two white saloons, a wheelhouse and a funnel. */
export function lakeShip(): ModelParts {
	const [length, width, height] = [60, 11, 9];
	const [hl, hw] = [length / 2, width / 2];
	return model(length, width, height, (tinted, fixed) => {
		tinted.plan(
			[
				[hl, 0],
				[hl - 15, hw],
				[-hl, hw],
				[-hl, -hw],
				[hl - 15, -hw],
			],
			-1.0,
			1.6,
			TINT,
		);
		fixed.plan(
			[
				[hl - 3, 0],
				[hl - 16, hw - 0.5],
				[-hl + 1, hw - 0.5],
				[-hl + 1, -hw + 0.5],
				[hl - 16, -hw + 0.5],
			],
			1.6,
			1.8,
			WHITE,
		);
		fixed.box([-24, -4.2, 1.8], [12, 4.2, 4.2], WHITE);
		windows(fixed, -23, 11, 4.2, 2.6, 3.5);
		fixed.box([-18, -3.6, 4.2], [6, 3.6, 6.2], WHITE);
		windows(fixed, -17, 5, 3.6, 4.8, 5.6);
		fixed.box([6, -2.2, 4.2], [10, 2.2, 7.0], WHITE);
		fixed.box([9.9, -2.0, 5.8], [10 + PROUD_M, 2.0, 6.6], GLASS);
		fixed.box([-4, -1.0, 6.2], [-1.5, 1.0, height], RUNNING_GEAR);
	});
}

/** Height from a cabin's floor up to the rope it hangs from (its hanger included). */
export const CABIN_ROPE_HEIGHT_M = 9;

/** An aerial tramway cabin, glazed all round, with its hanger arm and grip up to the rope. */
export function tramwayCabin(): ModelParts {
	const [length, width, height] = [10, 5, 4];
	const [hl, hw] = [length / 2, width / 2];
	return model(length, width, height, (tinted, fixed) => {
		tinted.box([-hl, -hw, 0], [hl, hw, 3.2], TINT);
		fixed.box([-hl - PROUD_M, -hw - PROUD_M, 1.3], [hl + PROUD_M, hw + PROUD_M, 2.7], GLASS);
		fixed.box([-hl + 0.4, -hw + 0.3, 3.2], [hl - 0.4, hw - 0.3, 3.6], ROOF);
		fixed.box([-0.25, -0.25, 3.6], [0.25, 0.25, CABIN_ROPE_HEIGHT_M - 0.3], RUNNING_GEAR);
		fixed.box([-0.9, -0.4, CABIN_ROPE_HEIGHT_M - 0.4], [0.9, 0.4, CABIN_ROPE_HEIGHT_M + 0.2], RUNNING_GEAR);
	});
}
