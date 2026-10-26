import { describe, expect, it } from "vitest";
import type { Motion } from "../src/contract/motion";
import { distanceM } from "../src/render/lonLat";
import { BODY_LENGTH_M, easedProgress, VehicleTimeline } from "../src/render/vehicleTimeline";
import { BERN, LONGITUDE_PER_5_KM, makeMotion } from "./fixtures";

const timeline = new VehicleTimeline(makeMotion());
const kmFromBern = (point: readonly [number, number]): number => distanceM(BERN, point) / 1000;

describe("precise vehicle timeline", () => {
	it("shows nothing before the first departure", () => {
		expect(timeline.vehiclesAt(470)).toEqual([]);
	});

	it("eases out of and into stations", () => {
		expect(easedProgress(480, 480, 490)).toBe(0);
		expect(easedProgress(485, 480, 490)).toBe(0.5);
		expect(easedProgress(482.5, 480, 490)).toBeCloseTo(0.15625);
		expect(easedProgress(495, 480, 490)).toBe(1);
	});

	it("puts a train halfway along the track at mid-journey, inside the tunnel there", () => {
		const [train] = timeline.vehiclesAt(485);
		expect(train?.layer).toBe("long_rail");
		expect(kmFromBern(train?.head ?? BERN)).toBeCloseTo(5, 1);
		expect(train?.isInsideTunnel).toBe(true);
	});

	it("draws the body as the last stretch of track behind the head", () => {
		const [train] = timeline.vehiclesAt(485);
		const body = train?.body ?? [];
		const rear = body[0] ?? BERN;
		const front = body.at(-1) ?? BERN;
		expect(distanceM(rear, front)).toBeCloseTo(BODY_LENGTH_M.long_rail, 0);
		expect(kmFromBern(rear)).toBeLessThan(kmFromBern(front)); // heading east
	});

	it("keeps the train visible while it waits at the station", () => {
		const [waiting] = timeline.vehiclesAt(492);
		expect(kmFromBern(waiting?.head ?? BERN)).toBeCloseTo(10, 1);
	});

	it("runs reversed legs backwards, body trailing to the east", () => {
		const [train] = timeline.vehiclesAt(500);
		const body = train?.body ?? [];
		expect(kmFromBern(train?.head ?? BERN)).toBeCloseTo(5, 1);
		expect(kmFromBern(body[0] ?? BERN)).toBeGreaterThan(kmFromBern(body.at(-1) ?? BERN));
	});

	it("is whole from the moment it departs: its rear cars stand on the lead-in", () => {
		const [train] = timeline.vehiclesAt(480.01);
		const body = train?.body ?? [];
		expect(distanceM(body[0] ?? BERN, body.at(-1) ?? BERN)).toBeCloseTo(BODY_LENGTH_M.long_rail, 0);
		expect((body[0] ?? BERN)[0]).toBeLessThan(BERN[0]); // west of Bern, behind the train
	});

	it("after reversing, trails behind its new direction, not folded over itself", () => {
		const [train] = timeline.vehiclesAt(495.01);
		const body = train?.body ?? [];
		expect(distanceM(body[0] ?? BERN, body.at(-1) ?? BERN)).toBeCloseTo(BODY_LENGTH_M.long_rail, 0);
		expect(kmFromBern(body[0] ?? BERN)).toBeGreaterThan(10);
	});

	it("crosses to another platform track as part of departing, without jumping", () => {
		const motion = throughStationMotion();
		const second = motion.segments[1];
		if (second === undefined) throw new Error("fixture has two segments");
		const shifted = second.coordinates.map((value, i) => (i % 2 === 1 ? value + 0.002 : value)); // ~220 m north
		const platforms = new VehicleTimeline({
			...motion,
			segments: [motion.segments[0] ?? second, { ...second, coordinates: shifted }],
		});
		const [waiting] = platforms.vehiclesAt(485.5);
		const [departing] = platforms.vehiclesAt(486.001);
		expect(distanceM(waiting?.head ?? BERN, departing?.head ?? BERN)).toBeLessThan(5);
	});

	it("stays whole through an intermediate station", () => {
		const through = new VehicleTimeline(throughStationMotion());
		const [train] = through.vehiclesAt(486.02);
		const body = train?.body ?? [];
		expect(kmFromBern(train?.head ?? BERN)).toBeLessThan(5.2);
		expect(distanceM(body[0] ?? BERN, body.at(-1) ?? BERN)).toBeCloseTo(BODY_LENGTH_M.long_rail, 0);
	});

	it("shows trips that run past midnight in the small hours", () => {
		const [late] = timeline.vehiclesAt(5); // 24:05
		expect(late?.layer).toBe("regional_rail");
	});

	it("finds one trip's position, or null when it isn't running", () => {
		expect(timeline.positionOfTrip(0, 485)).not.toBeNull();
		expect(timeline.positionOfTrip(0, 600)).toBeNull();
	});
});

/** One IC east from Bern, stopping at 5 km: two legs on two segments, one run. */
function throughStationMotion(): Motion {
	const base = makeMotion();
	const [longitude, latitude] = BERN;
	const at5 = longitude + LONGITUDE_PER_5_KM;
	const segment = (from: number, to: number) => ({
		coordinates: [from, latitude, to, latitude],
		overview_coordinates: [from, latitude, to, latitude],
		length_m: 5_000,
		route: "track" as const,
		tunnels: [],
	});
	return {
		...base,
		segments: [segment(longitude, at5), segment(at5, at5 + LONGITUDE_PER_5_KM)],
		trips: { layer: ["long_rail"], first_leg: [0], leg_count: [2] },
		legs: {
			segment: [0, 1],
			reversed: [false, false],
			depart_minute: [480, 486],
			arrive_minute: [485, 491],
			lead_in: [0, -1],
		},
	};
}
