import type { Layer } from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import { FLAT_MAP, TERRAIN } from "../src/render/elevation";
import { distanceM, headingDeg, type LonLat, offsetLonLat } from "../src/render/lonLat";
import { SCREEN_PALETTE } from "../src/render/palette";
import { PathMeasure } from "../src/render/pathMeasure";
import { type VehicleState, VehicleTimeline } from "../src/render/vehicleTimeline";
import { CABLE, cablePath } from "../src/vehicles/cableCarKind";
import { CarsAlongTrack, cableHeightM, HangingFromCable, HullOnWater, type Pose3D } from "../src/vehicles/motion";
import { MOVING_LAYERS, standardVehicleKinds, VehicleKindRegistry } from "../src/vehicles/registry";
import { Box, Hull } from "../src/vehicles/shape";
import { carsIn, INTERCITY_CAR, TrainKind } from "../src/vehicles/trainKind";
import type { VehicleFrame } from "../src/vehicles/vehicleKind";
import { BERN, makeMotion } from "./fixtures";

const east = (metres: number): LonLat => offsetLonLat(BERN, metres, 0);
const north = (from: LonLat, metres: number): LonLat => offsetLonLat(from, 0, metres);

/** A vehicle whose front is `headM` along `path`; the path runs east from Bern unless given. */
function vehicleAt(headM: number, path = new PathMeasure([BERN, east(2000)]), overrides: Partial<VehicleState> = {}) {
	const vehicle: VehicleState = {
		path,
		headM,
		tailStartM: Math.max(0, headM - 300),
		legStartM: 0,
		legEndM: path.lengthM,
		trip: 0,
		layer: "long_rail",
		head: path.at(headM).point,
		body: path.stretch(headM - 400, headM),
		tail: path.stretch(headM - 300, headM),
		isInsideTunnel: false,
		legFrom: path.at(0).point,
		legTo: path.at(path.lengthM).point,
		...overrides,
	};
	return vehicle;
}

/** Zoom 19 or so: a pixel is a few centimetres, so every vehicle is drawn at its real size. */
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
const ON_TERRAIN = { elevation: TERRAIN, nowMs: 0 };
const dataOf = (layer: Layer | undefined): readonly unknown[] => (layer?.props.data ?? []) as readonly unknown[];
const lonLatOf = (pose: Pose3D | undefined): LonLat => [pose?.position[0] ?? 0, pose?.position[1] ?? 0];

describe("paths with heights", () => {
	it("offsets a point by metres and measures headings clockwise from north", () => {
		expect(distanceM(BERN, east(100))).toBeCloseTo(100, 1);
		expect(headingDeg(BERN, east(100))).toBeCloseTo(90, 5);
		expect(headingDeg(BERN, north(BERN, 100))).toBeCloseTo(0, 5);
		expect(headingDeg(BERN, offsetLonLat(BERN, -100, 0))).toBeCloseTo(270, 5);
	});

	it("finds the point, height and direction a distance along a path, clamped to its ends", () => {
		const path = new PathMeasure([BERN, east(1000), north(east(1000), 1000)], [500, 600, 600]);
		expect(path.lengthM).toBeCloseTo(2000, 0);
		expect(distanceM(path.at(500).point, east(500))).toBeLessThan(0.01);
		expect(path.at(500).heightM).toBeCloseTo(550, 1);
		expect(path.at(500).headingDeg).toBeCloseTo(90, 3);
		expect(path.at(1500).headingDeg).toBeCloseTo(0, 3);
		expect(path.at(-10).point).toEqual(BERN);
		expect(path.stretchWithHeights(900, 1100).map(([, , heightM]) => Math.round(heightM))).toEqual([590, 600, 600]);
	});
});

describe("shapes", () => {
	const pose: Pose3D = { position: [BERN[0], BERN[1], 7], yawDeg: 90, pitchDeg: 0, rollDeg: 0 };

	it("lays a box's footprint around its centre, turned to its heading, at its altitude", () => {
		const corners = new Box(20, 4, 3).footprint(pose);
		expect(corners).toHaveLength(4);
		expect(corners.every(([, , heightM]) => heightM === 7)).toBe(true);
		const [frontLeft, , rearRight] = corners.map(([lon, lat]): LonLat => [lon, lat]);
		expect(distanceM(frontLeft ?? BERN, rearRight ?? BERN)).toBeCloseTo(Math.hypot(20, 4), 1);
	});

	it("draws a narrow shape wider from further out, keeping its length and capping its height", () => {
		const car = new Box(26.8, 2.8, 4.6);
		expect(car.widened(2)).toBe(car);
		const middle = car.widened(10);
		expect([middle.lengthM, middle.widthM, middle.heightM]).toEqual([26.8, 10, 9.2]);
		expect(car.widened(40).widthM).toBeCloseTo(26.8 * 0.6, 6);
	});

	it("points a hull's bow where the boat is heading", () => {
		const [bow] = new Hull(60, 11, 5).footprint(pose);
		expect(distanceM(BERN, [bow?.[0] ?? 0, bow?.[1] ?? 0])).toBeCloseTo(30, 1);
		expect(bow?.[0]).toBeGreaterThan(BERN[0]);
	});
});

describe("motion models", () => {
	const intercity = new CarsAlongTrack(INTERCITY_CAR.lengthM, INTERCITY_CAR.gapM, 14);

	it("fits an IC's cars into the length it occupies on the track", () => {
		expect(carsIn(400, INTERCITY_CAR)).toBe(14);
		const cars = intercity.place(vehicleAt(1000), FRAME);
		expect(cars).toHaveLength(14);
		expect(distanceM(lonLatOf(cars[0]), east(1000))).toBeCloseTo(INTERCITY_CAR.lengthM / 2, 1);
		expect(cars.every((car) => Math.abs(car.yawDeg - 90) < 1e-6 && car.position[2] === 0)).toBe(true);
	});

	it("never places cars before the start of its run", () => {
		expect(intercity.place(vehicleAt(100), FRAME)).toHaveLength(3);
	});

	it("tilts each car with the gradient under its bogies, on the terrain only", () => {
		const climb = new PathMeasure([BERN, east(1000)], [500, 600]); // 10 %
		const [car] = intercity.place(vehicleAt(800, climb), ON_TERRAIN);
		expect(car?.pitchDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 1);
		expect(car?.position[2]).toBeCloseTo(500 + 0.1 * (800 - INTERCITY_CAR.lengthM / 2), 0);
		expect(intercity.place(vehicleAt(800, climb), FRAME)[0]?.pitchDeg).toBe(0);
	});

	it("turns each car with the curve under its bogies", () => {
		const bend = new PathMeasure([BERN, east(500), north(east(500), 500)]);
		const [first, second] = intercity.place(vehicleAt(510, bend), FRAME);
		expect(first?.yawDeg).toBeGreaterThan(0);
		expect(first?.yawDeg).toBeLessThan(90);
		expect(second?.yawDeg).toBeCloseTo(90, 0);
	});

	it("puts a hull's centre half a boat behind its bow, rocking within the swell", () => {
		const swell = { rollDeg: 2.5, pitchDeg: 1, periodMs: 5000 };
		const hull = new HullOnWater(60, swell);
		const [boat] = hull.place(vehicleAt(1000, undefined, { layer: "boat" }), FRAME);
		expect(distanceM(lonLatOf(boat), east(970))).toBeLessThan(0.1);
		for (const nowMs of [0, 1000, 2000, 3000]) {
			const [rocking] = hull.place(vehicleAt(1000), { elevation: FLAT_MAP, nowMs });
			expect(Math.abs(rocking?.rollDeg ?? 99)).toBeLessThanOrEqual(swell.rollDeg);
		}
	});

	it("hangs a cabin lowest in the middle of its span", () => {
		expect(cableHeightM(CABLE, 2000, 0)).toBe(CABLE.stationHeightM);
		expect(cableHeightM(CABLE, 2000, 0.5)).toBeCloseTo(CABLE.stationHeightM - 40, 6);
		const [cabin] = new HangingFromCable(CABLE, 9).place(vehicleAt(1000, undefined, { layer: "aerial" }), FRAME);
		expect(cabin?.position[2]).toBeCloseTo(CABLE.stationHeightM - 40 - 9, 1);
		expect(cabin?.yawDeg).toBeCloseTo(90, 3);
	});

	it("strings the rope from station to station at their altitudes on the terrain", () => {
		const rope = cablePath([BERN[0], BERN[1], 1000], [...east(2000), 1600], TERRAIN);
		expect(rope[0]?.[2]).toBe(1000 + CABLE.stationHeightM);
		expect(rope.at(-1)?.[2]).toBe(1600 + CABLE.stationHeightM);
		const flat = cablePath([BERN[0], BERN[1], 1000], [...east(2000), 1600], FLAT_MAP);
		expect(flat[0]?.[2]).toBe(CABLE.stationHeightM);
	});
});

describe("vehicle kinds", () => {
	it("needs exactly one kind for every moving layer", () => {
		expect(() => new VehicleKindRegistry(standardVehicleKinds())).not.toThrow();
		expect(() => new VehicleKindRegistry(standardVehicleKinds().slice(1))).toThrow(/long_rail/);
		expect(
			() => new VehicleKindRegistry([...standardVehicleKinds(), new TrainKind("long_rail", INTERCITY_CAR)]),
		).toThrow(/two vehicle kinds/);
	});

	it("draws every kind every frame, so deck.gl keeps the same layers", () => {
		const registry = new VehicleKindRegistry(standardVehicleKinds());
		const ids = registry.draw([vehicleAt(1000)], FRAME).map((layer) => layer.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(registry.draw([], FRAME).map((layer) => layer.id));
		expect(MOVING_LAYERS.every((layer) => ids.some((id) => id.includes(layer)))).toBe(true);
	});

	it("poses only the vehicles in view", () => {
		const registry = new VehicleKindRegistry(standardVehicleKinds());
		const carsOf = (frame: VehicleFrame) =>
			dataOf(registry.draw([vehicleAt(1000)], frame).find((layer) => layer.id.includes("long_rail")));
		expect(carsOf(FRAME)).toHaveLength(14);
		expect(carsOf({ ...FRAME, visibleArea: [0, 0, 1, 1] })).toHaveLength(0);
	});

	it("hides trains while they are under the mountain", () => {
		const kind = new TrainKind("long_rail", INTERCITY_CAR);
		expect(dataOf(kind.draw([vehicleAt(1000)], FRAME)[0])).toHaveLength(14);
		expect(dataOf(kind.draw([vehicleAt(1000, undefined, { isInsideTunnel: true })], FRAME)[0])).toHaveLength(0);
	});

	it("knows where each leg starts and ends, in the direction of travel, with heights", () => {
		const timeline = new VehicleTimeline(makeMotion());
		const [outbound] = timeline.vehiclesAt(483);
		const [inbound] = timeline.vehiclesAt(500);
		expect(distanceM(outbound?.legFrom ?? east(1), BERN)).toBeLessThan(1);
		expect(distanceM(outbound?.legTo ?? BERN, BERN)).toBeCloseTo(10_000, -1);
		expect(distanceM(inbound?.legTo ?? east(1), BERN)).toBeLessThan(1);
		expect(outbound?.path.at(outbound.legEndM).heightM).toBeCloseTo(640, 0);
	});
});
