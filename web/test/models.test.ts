import { describe, expect, it } from "vitest";
import { FLAT_MAP } from "../src/render/elevation";
import { SCREEN_PALETTE } from "../src/render/palette";
import {
	CABIN_ROPE_HEIGHT_M,
	funicularCar,
	gondolaCabin,
	intercityCoach,
	lakeShip,
	liftChair,
	type ModelParts,
	mountainCar,
	re460Locomotive,
	sBahnCabCar,
	sBahnCar,
	tramwayCabin,
} from "../src/vehicles/models/catalogue";
import { extentOf, MeshBuilder, TRIANGLES_PER_BOX } from "../src/vehicles/models/meshBuilder";
import {
	BoxModel,
	DETAILED_MIN_LENGTH_PX,
	deckOrientation,
	LevelOfDetail,
	MeshModel,
} from "../src/vehicles/models/vehicleModel";
import { Box } from "../src/vehicles/shape";
import type { VehicleFrame } from "../src/vehicles/vehicleKind";

const FRAME: VehicleFrame = {
	palette: SCREEN_PALETTE,
	opacity: 1,
	idPrefix: "test",
	beforeId: "labels",
	elevation: FLAT_MAP,
	nowMs: 0,
	metresPerPixel: 0.2,
	visibleArea: [-180, -90, 180, 90],
};

describe("mesh builder", () => {
	it("builds a box from twelve triangles with normals pointing outwards", () => {
		const mesh = new MeshBuilder().box([-1, -2, 0], [1, 2, 3], [1, 0, 0]).build();
		expect(mesh.vertexCount).toBe(TRIANGLES_PER_BOX * 3);
		for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
			const position = [0, 1, 2].map((axis) => mesh.positions[vertex * 3 + axis] ?? 0);
			const normal = [0, 1, 2].map((axis) => mesh.normals[vertex * 3 + axis] ?? 0);
			const fromCentre = [position[0] ?? 0, position[1] ?? 0, (position[2] ?? 0) - 1.5];
			const outwards = normal.reduce((sum, value, axis) => sum + value * (fromCentre[axis] ?? 0), 0);
			expect(outwards).toBeGreaterThan(0);
		}
		expect(extentOf(mesh)).toEqual({ min: [-1, -2, 0], max: [1, 2, 3] });
	});

	it("extrudes plans and side profiles between the given levels", () => {
		const hull = new MeshBuilder()
			.plan(
				[
					[3, 0],
					[0, 1],
					[-3, 1],
					[-3, -1],
					[0, -1],
				],
				-0.5,
				1,
				[1, 1, 1],
			)
			.build();
		expect(extentOf(hull)).toEqual({ min: [-3, -1, -0.5], max: [3, 1, 1] });
	});
});

describe("vehicle catalogue", () => {
	const models: [string, ModelParts][] = [
		["IC coach", intercityCoach()],
		["Re 460", re460Locomotive()],
		["S-Bahn car", sBahnCar()],
		["S-Bahn cab car", sBahnCabCar()],
		["mountain car", mountainCar()],
		["funicular", funicularCar()],
		["lake ship", lakeShip()],
		["cabin", tramwayCabin()],
		["gondola", gondolaCabin()],
		["chair", liftChair()],
	];

	it.each(models)("models the %s at its stated size, standing on its origin", (_, parts) => {
		const meshes = [parts.tinted, parts.fixed].filter((mesh) => mesh.vertexCount > 0);
		const extents = meshes.map(extentOf);
		const length = Math.max(...extents.map((e) => e.max[0])) - Math.min(...extents.map((e) => e.min[0]));
		const width = Math.max(...extents.map((e) => e.max[1])) - Math.min(...extents.map((e) => e.min[1]));
		expect(length).toBeCloseTo(parts.lengthM, 0);
		expect(width).toBeCloseTo(parts.widthM, 0);
		expect(Math.max(...extents.map((e) => e.max[2]))).toBeLessThanOrEqual(
			Math.max(parts.heightM, CABIN_ROPE_HEIGHT_M + 0.2),
		);
		expect(parts.tinted.vertexCount).toBeGreaterThan(0);
	});

	it("points the locomotive's nose forward", () => {
		const { min, max } = extentOf(re460Locomotive().tinted);
		expect(max[0]).toBeCloseTo(-min[0], 1);
		expect(extentOf(re460Locomotive().fixed).max[0]).toBeGreaterThan(8); // the windscreen, at the front
	});
});

describe("models and their level of detail", () => {
	it("turns a compass heading and a nose-up pitch into deck.gl's orientation", () => {
		expect(deckOrientation({ position: [0, 0, 0], yawDeg: 90, pitchDeg: 0, rollDeg: 0 })).toEqual([-0, 0, 0]);
		expect(deckOrientation({ position: [0, 0, 0], yawDeg: 0, pitchDeg: 5, rollDeg: 2 })).toEqual([-5, 90, 2]);
	});

	it("draws the detailed model only when it's long enough on screen", () => {
		const coach = intercityCoach();
		const lod = new LevelOfDetail(new MeshModel(coach), new BoxModel(new Box(coach.lengthM, 2.8, 4.6)));
		const near = lod.choose({ ...FRAME, metresPerPixel: coach.lengthM / (DETAILED_MIN_LENGTH_PX + 1) });
		const far = lod.choose({ ...FRAME, metresPerPixel: coach.lengthM / (DETAILED_MIN_LENGTH_PX - 1) });
		expect(near.isDetailed).toBe(true);
		expect(far.isDetailed).toBe(false);
		expect(near.model.layers("a", [], [255, 0, 0, 255], FRAME)).toHaveLength(2);
		expect(far.model.layers("a", [], [255, 0, 0, 255], FRAME)).toHaveLength(1);
	});
});
