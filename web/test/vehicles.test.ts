import type { Layer } from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import { distanceM, headingDeg, type LonLat, offsetLonLat } from "../src/render/lonLat";
import { SCREEN_PALETTE } from "../src/render/palette";
import { type VehicleState, VehicleTimeline } from "../src/render/vehicleTimeline";
import { CABLE, cablePath } from "../src/vehicles/cableCarKind";
import { CarsAlongTrack, cableHeightM, HangingFromCable, SingleHull } from "../src/vehicles/motion";
import { PathMeasure } from "../src/vehicles/pathMeasure";
import { MOVING_LAYERS, standardVehicleKinds, VehicleKindRegistry } from "../src/vehicles/registry";
import { Box, Hull } from "../src/vehicles/shape";
import { carsIn, INTERCITY_CAR, TrainKind } from "../src/vehicles/trainKind";
import type { VehicleFrame } from "../src/vehicles/vehicleKind";
import { BERN, makeMotion } from "./fixtures";

const east = (metres: number): LonLat => offsetLonLat(BERN, metres, 0);

/** A vehicle heading east from Bern whose body is the last `bodyM` metres before its head. */
function vehicleEast(bodyM: number, overrides: Partial<VehicleState> = {}): VehicleState {
	const head = east(1000);
	return {
		trip: 0,
		layer: "long_rail",
		head,
		body: [east(1000 - bodyM), head],
		tail: [BERN, head],
		isInsideTunnel: false,
		legFrom: BERN,
		legTo: east(2000),
		...overrides,
	};
}

const FRAME: VehicleFrame = { palette: SCREEN_PALETTE, opacity: 1, idPrefix: "test", beforeId: "labels" };
const dataOf = (layer: Layer | undefined): readonly unknown[] => (layer?.props.data ?? []) as readonly unknown[];

describe("geometry for solids", () => {
	it("offsets a point by metres and measures headings clockwise from north", () => {
		expect(distanceM(BERN, east(100))).toBeCloseTo(100, 1);
		expect(headingDeg(BERN, east(100))).toBeCloseTo(90, 5);
		expect(headingDeg(BERN, offsetLonLat(BERN, 0, 100))).toBeCloseTo(0, 5);
		expect(headingDeg(BERN, offsetLonLat(BERN, -100, 0))).toBeCloseTo(270, 5);
	});

	it("finds the point and direction a distance along a path, clamped to its ends", () => {
		const path = new PathMeasure([BERN, east(1000), offsetLonLat(east(1000), 0, 1000)]);
		expect(path.lengthM).toBeCloseTo(2000, 0);
		expect(distanceM(path.at(500).point, east(500))).toBeLessThan(0.01);
		expect(path.at(500).headingDeg).toBeCloseTo(90, 3);
		expect(path.at(1500).headingDeg).toBeCloseTo(0, 3);
		expect(path.at(-10).point).toEqual(BERN);
	});
});

describe("shapes", () => {
	const placement = { centre: BERN, headingDeg: 90, baseM: 7 };

	it("lays a box's footprint around its centre, turned to its heading, at its base height", () => {
		const corners = new Box(20, 4, 3).footprint(placement);
		expect(corners).toHaveLength(4);
		expect(corners.every(([, , heightM]) => heightM === 7)).toBe(true);
		const [frontLeft, , rearRight] = corners.map(([lon, lat]): LonLat => [lon, lat]);
		expect(distanceM(frontLeft ?? BERN, rearRight ?? BERN)).toBeCloseTo(Math.hypot(20, 4), 1);
	});

	it("points a hull's bow where the boat is heading", () => {
		const [bow] = new Hull(60, 11, 5).footprint(placement);
		expect(distanceM(BERN, [bow?.[0] ?? 0, bow?.[1] ?? 0])).toBeCloseTo(30, 1);
		expect(bow?.[0]).toBeGreaterThan(BERN[0]);
	});
});

describe("motion models", () => {
	it("fits an IC's cars into the length it occupies on the track", () => {
		expect(carsIn(400, INTERCITY_CAR)).toBe(14);
		const cars = new CarsAlongTrack(INTERCITY_CAR.lengthM, INTERCITY_CAR.gapM, 14).place(vehicleEast(400));
		expect(cars).toHaveLength(14);
		expect(distanceM(cars[0]?.centre ?? BERN, east(1000))).toBeCloseTo(INTERCITY_CAR.lengthM / 2, 1);
		expect(cars.every((car) => Math.abs(car.headingDeg - 90) < 1e-6 && car.baseM === 0)).toBe(true);
	});

	it("rolls a train out of its first station car by car", () => {
		const cars = new CarsAlongTrack(INTERCITY_CAR.lengthM, INTERCITY_CAR.gapM, 14).place(vehicleEast(100));
		expect(cars).toHaveLength(3);
	});

	it("puts a hull's centre half a boat behind its bow", () => {
		const [hull] = new SingleHull(60).place(vehicleEast(60));
		expect(distanceM(hull?.centre ?? BERN, east(970))).toBeLessThan(0.1);
	});

	it("hangs a cabin lowest in the middle of its span", () => {
		const spanM = 2000;
		expect(cableHeightM(CABLE, spanM, 0)).toBe(CABLE.stationHeightM);
		expect(cableHeightM(CABLE, spanM, 0.5)).toBeCloseTo(CABLE.stationHeightM - 40, 6);
		const [cabin] = new HangingFromCable(CABLE, 9).place(vehicleEast(10, { layer: "aerial" }));
		expect(cabin?.baseM).toBeCloseTo(CABLE.stationHeightM - 40 - 9, 1);
		expect(cabin?.headingDeg).toBeCloseTo(90, 3);
	});

	it("draws a cable from station to station at station height", () => {
		const cable = cablePath(BERN, east(2000));
		expect(cable[0]).toEqual([BERN[0], BERN[1], CABLE.stationHeightM]);
		expect(cable.at(-1)?.[2]).toBe(CABLE.stationHeightM);
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
		const layers = registry.draw([vehicleEast(400)], FRAME);
		const ids = layers.map((layer) => layer.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(registry.draw([], FRAME).map((layer) => layer.id));
		expect(MOVING_LAYERS.every((layer) => ids.some((id) => id.includes(layer)))).toBe(true);
	});

	it("hides trains while they are under the mountain", () => {
		const kind = new TrainKind("long_rail", INTERCITY_CAR);
		expect(dataOf(kind.draw([vehicleEast(400)], FRAME)[0])).toHaveLength(14);
		expect(dataOf(kind.draw([vehicleEast(400, { isInsideTunnel: true })], FRAME)[0])).toHaveLength(0);
	});

	it("knows where each leg starts and ends, in the direction of travel", () => {
		const timeline = new VehicleTimeline(makeMotion());
		const [outbound] = timeline.vehiclesAt(483);
		const [inbound] = timeline.vehiclesAt(500);
		expect(distanceM(outbound?.legFrom ?? east(1), BERN)).toBeLessThan(1);
		expect(distanceM(outbound?.legTo ?? BERN, BERN)).toBeCloseTo(10_000, -1);
		expect(distanceM(inbound?.legTo ?? east(1), BERN)).toBeLessThan(1);
	});
});
