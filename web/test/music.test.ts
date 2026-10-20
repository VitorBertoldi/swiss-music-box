import { describe, expect, it } from "vitest";
import { NoteBudget } from "../src/music/budget";
import { MINUTES_PER_DAY, REGISTER } from "../src/music/constants";
import { chordAt, chordChangeMinutes, snapToChord, voicing } from "../src/music/harmony";
import { altitudeScale } from "../src/music/pitch";
import { buildScore } from "../src/music/score";
import { panOf, zoneOf } from "../src/music/space";
import type { PitchMapping, ScoreSettings } from "../src/music/types";
import { makeDay } from "./fixtures";

const SETTINGS: ScoreSettings = { durationS: 180, notesPerSecond: 30, pitchMapping: "rank" };

describe("harmony", () => {
	it("follows the day: open at night, lydian at the evening rush", () => {
		expect(chordAt(0).name).toBe("Dsus2");
		expect(chordAt(17 * 60).name).toBe("G lydian");
		expect(chordAt(MINUTES_PER_DAY - 1).name).toBe("Bm(add9)");
	});

	it("starts at midnight and changes in order", () => {
		const changes = chordChangeMinutes();
		expect(changes[0]).toBe(0);
		expect([...changes].sort((a, b) => a - b)).toEqual(changes);
	});

	it("snaps every pitch to a nearby chord tone", () => {
		for (let minute = 0; minute < MINUTES_PER_DAY; minute += 60) {
			const chord = chordAt(minute);
			for (let raw = 30; raw < 100; raw += 0.7) {
				const snapped = snapToChord(raw, chord);
				expect(chord.pitchClasses).toContain(snapped % 12);
				expect(Math.abs(snapped - raw)).toBeLessThanOrEqual(6.5);
			}
		}
	});

	it("voices chords upward from the root", () => {
		const notes = voicing(chordAt(6 * 60), 50, 4); // Gmaj7
		expect(notes).toEqual([55, 59, 62, 66]);
	});
});

describe("altitude -> pitch", () => {
	const elevations = [200, 400, 450, 500, 600, 1500, 3454];

	it.each<PitchMapping>(["linear", "log", "rank"])("%s is monotonic and within 0..1", (mapping) => {
		const scale = altitudeScale(elevations, mapping);
		const values = elevations.map(scale);
		expect(values[0]).toBe(0);
		expect(values[values.length - 1]).toBe(1);
		expect([...values].sort((a, b) => a - b)).toEqual(values);
	});

	it("rank spreads the crowded lowlands over the register", () => {
		const linear = altitudeScale(elevations, "linear");
		const rank = altitudeScale(elevations, "rank");
		expect(linear(500)).toBeLessThan(0.1);
		expect(rank(500)).toBeCloseTo(0.5);
	});
});

describe("space", () => {
	const bounds = makeDay([]).bounds;

	it("pans west to east", () => {
		expect(panOf(bounds.min_easting_m, bounds)).toBe(-1);
		expect(panOf(bounds.max_easting_m, bounds)).toBe(1);
		expect(zoneOf(-1)).toBe("west");
		expect(zoneOf(0)).toBe("centre");
		expect(zoneOf(1)).toBe("east");
	});
});

describe("note budget", () => {
	it("holds the long-run rate and keeps the best candidates", () => {
		const budget = new NoteBudget(0.5);
		const taken = Array.from({ length: 100 }, (_, minute) => budget.take(minute, [3, 1, 2], (a, b) => a - b));
		expect(taken.flat()).toHaveLength(50);
		expect(taken.flat().every((x) => x === 1)).toBe(true);
	});

	it("lets a lone event after a quiet stretch through", () => {
		const budget = new NoteBudget(0.2);
		expect(budget.take(0, [], () => 0)).toHaveLength(0);
		expect(budget.take(30, ["boat"], () => 0)).toEqual(["boat"]);
	});

	it("does not bank silence into a burst", () => {
		const budget = new NoteBudget(0.5);
		budget.take(0, [], () => 0);
		expect(budget.take(500, [1, 2, 3, 4], () => 0)).toHaveLength(1);
	});

	it("rejects time going backwards", () => {
		const budget = new NoteBudget(1);
		budget.take(10, [], () => 0);
		expect(() => budget.take(5, [], () => 0)).toThrow(RangeError);
	});
});

describe("score", () => {
	const day = makeDay([
		[480, 0, "long_rail", true],
		[480, 2, "aerial", true],
		[480, 1, "long_rail", false],
		[900, 2, "mountain_rail", false],
	]);

	it("is deterministic", () => {
		expect(buildScore(day, SETTINGS)).toEqual(buildScore(day, SETTINGS));
	});

	it("keeps notes sorted, strummed within their minute, and in register", () => {
		const { notes } = buildScore(day, SETTINGS);
		expect(notes.map((n) => n.minute)).toEqual([...notes.map((n) => n.minute)].sort((a, b) => a - b));
		for (const note of notes) {
			const [low, high] = REGISTER[note.layer];
			expect(note.midi).toBeGreaterThanOrEqual(low - 6);
			expect(note.midi).toBeLessThanOrEqual(high + 6);
			expect(note.minute - Math.floor(note.minute)).toBeLessThan(1);
		}
	});

	it("gives the high station a higher pitch and the eastern one a right pan", () => {
		const { notes } = buildScore(day, { ...SETTINGS, notesPerSecond: 1000 });
		const geneva = notes.find((n) => n.station === 0 && n.layer === "long_rail");
		const bern = notes.find((n) => n.station === 1 && n.layer === "long_rail");
		expect(geneva?.pan).toBeLessThan(bern?.pan ?? 0);
		expect(geneva?.midi).toBeLessThanOrEqual(bern?.midi ?? 0);
	});

	it("normalises textures per layer and maps bins to zones", () => {
		const bus = buildScore(day, SETTINGS).textures.bus;
		expect(bus.west[480]).toBe(1);
		expect(bus.east[480]).toBe(0.5);
		expect(bus.centre[480]).toBe(0);
	});

	it("turns tunnel occupancy into a drone level", () => {
		const [tunnel] = buildScore(day, SETTINGS).tunnels;
		expect(tunnel?.level[610]).toBeCloseTo(2 / 3);
		expect(tunnel?.level[0]).toBe(0);
	});
});
