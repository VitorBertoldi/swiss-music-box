import { describe, expect, it } from "vitest";
import { distanceM } from "../src/render/lonLat";
import { BODY_LENGTH_M, easedProgress, VehicleTimeline } from "../src/render/vehicleTimeline";
import { BERN, makeMotion } from "./fixtures";

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

	it("shows trips that run past midnight in the small hours", () => {
		const [late] = timeline.vehiclesAt(5); // 24:05
		expect(late?.layer).toBe("regional_rail");
	});

	it("finds one trip's position, or null when it isn't running", () => {
		expect(timeline.positionOfTrip(0, 485)).not.toBeNull();
		expect(timeline.positionOfTrip(0, 600)).toBeNull();
	});
});
