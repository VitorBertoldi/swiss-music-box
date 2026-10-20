import { describe, expect, it } from "vitest";
import { distanceM, toLonLats } from "../src/render/lonLat";
import { packTracks, trackColours } from "../src/render/packedPaths";
import { SCREEN_PALETTE } from "../src/render/palette";
import { labelled } from "../src/render/tunnelLayers";
import { prepareSegment, reversedVertices, VehicleTrackBuilder } from "../src/render/vehicles";
import { BERN, LONGITUDE_PER_5_KM, makeMotion } from "./fixtures";

const firstSegment = () => {
	const segment = makeMotion().segments[0];
	if (segment === undefined) throw new Error("fixture has no segment");
	return segment;
};

describe("lon/lat helpers", () => {
	it("measures metres between nearby points", () => {
		expect(distanceM(BERN, [BERN[0] + LONGITUDE_PER_5_KM, BERN[1]])).toBeCloseTo(5000, 0);
		expect(toLonLats([7, 46, 8, 47])).toEqual([
			[7, 46],
			[8, 47],
		]);
	});
});

describe("overview vehicle tracks (long exposure)", () => {
	const tracks = new VehicleTrackBuilder(makeMotion()).build();
	const [shuttle, lateTrain] = tracks.all;

	it("inserts vertices where the segment enters and leaves its tunnel", () => {
		const { forward } = prepareSegment(firstSegment());
		expect(forward.fractions.map((fraction) => Number(fraction.toFixed(6)))).toEqual([0, 0.2, 0.5, 0.6, 1]);
		expect(forward.insideTunnel).toEqual([false, true, true, false, false]);
	});

	it("travelled backwards, the tunnel flag still describes the stretch ahead", () => {
		const backward = reversedVertices(prepareSegment(firstSegment()).forward);
		expect(backward.insideTunnel).toEqual([false, true, true, false, false]);
	});

	it("spreads each leg's time over its path by distance, waiting at stations", () => {
		const times = Array.from(shuttle?.timestamps ?? []).map((time) => Math.round(time * 100) / 100);
		expect(times).toEqual([480, 482, 485, 486, 490, 495, 499, 500, 503, 505]);
	});

	it("collects trips running past midnight for the second pass", () => {
		expect(tracks.pastMidnight).toEqual([lateTrain]);
		expect(tracks.vertexCount).toBe(15);
	});

	it("dims vehicle colours inside tunnels", () => {
		const packed = packTracks(tracks.all);
		const colours = trackColours(packed, SCREEN_PALETTE);
		const alphaOf = (vertex: number): number => colours[vertex * 4 + 3] as number;
		const openAlpha = SCREEN_PALETTE.vehicles.long_rail[3];
		expect(alphaOf(0)).toBe(openAlpha);
		expect(alphaOf(1)).toBe(Math.round(openAlpha * SCREEN_PALETTE.insideTunnelAlpha));
	});
});

describe("tunnel labels", () => {
	const tunnel = (name: string, lengthM: number, longitude: number) => ({
		name,
		lengthM,
		axis: [
			[longitude, 46.9],
			[longitude + 0.01, 46.9],
		] as [number, number][],
	});

	it("keeps the longer of two nearby tunnels and any tunnel far away", () => {
		const kept = labelled([tunnel("summit", 15_000, 8.6), tunnel("base", 57_000, 8.65), tunnel("far", 9_000, 9.9)]);
		expect(kept.map((label) => label.name)).toEqual(["base", "far"]);
	});
});
