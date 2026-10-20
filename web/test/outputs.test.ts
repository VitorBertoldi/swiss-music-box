import { existsSync, readFileSync } from "node:fs";
import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import type { Day } from "../src/contract/day";
import { assertContract } from "../src/data/showData";
import { MINUTES_PER_DAY } from "../src/music/constants";
import { buildScore } from "../src/music/score";
import { scoreToMidi, tempoFor } from "../src/outputs/midiFile";
import { HARMONY_CHANNEL, levelCc, noteChannel } from "../src/outputs/midiMap";
import { firstNoteAtOrAfter } from "../src/player";
import { makeDay } from "./fixtures";

const REAL_DAY = new URL("../public/data/2026-10-21.json", import.meta.url);

describe("MIDI layout", () => {
	it("keeps note channels clear of the harmony channel", () => {
		expect(noteChannel("long_rail", "west", "per-layer")).toBe(0);
		expect(noteChannel("funicular", "east", "per-layer-and-zone")).toBe(14);
		expect(noteChannel("funicular", "east", "per-layer-and-zone")).toBeLessThan(HARMONY_CHANNEL);
	});

	it("gives every level its own CC", () => {
		const ccs = new Set([
			levelCc({ kind: "texture", layer: "bus", zone: "east" }),
			levelCc({ kind: "texture", layer: "regional_rail", zone: "west" }),
			levelCc({ kind: "tunnel", index: 0, id: "a", pan: 0 }),
			levelCc({ kind: "tunnel", index: 7, id: "b", pan: 0 }),
		]);
		expect(ccs.size).toBe(4);
	});
});

describe("MIDI file", () => {
	const day = makeDay([
		[10, 0, "long_rail", true],
		[900, 2, "aerial", true],
	]);

	it("keeps one timetable minute = one 16th note", () => {
		expect(tempoFor(180)).toBe(120);
		const midi = new Midi(
			scoreToMidi(buildScore(day, { durationS: 180, notesPerSecond: 30, pitchMapping: "rank" }), {
				durationS: 180,
				layout: "per-layer",
			}),
		);
		expect(midi.header.tempos[0]?.bpm).toBeCloseTo(120);
		expect(midi.duration).toBeCloseTo(180, 0);
		const ic = midi.tracks.find((t) => t.channel === 0);
		expect(ic?.notes[0]?.ticks).toBe(10 * (midi.header.ppq / 4));
	});

	it("writes a harmony track carrying the level CCs", () => {
		const midi = new Midi(
			scoreToMidi(buildScore(day, { durationS: 600, notesPerSecond: 30, pitchMapping: "rank" }), {
				durationS: 600,
				layout: "per-layer",
			}),
		);
		expect(midi.header.tempos[0]?.bpm).toBeCloseTo(36);
		const harmony = midi.tracks.find((t) => t.channel === HARMONY_CHANNEL);
		const tunnelCc = levelCc({ kind: "tunnel", index: 0, id: "gotthard_base", pan: 0 });
		expect(harmony?.notes.length).toBeGreaterThan(0);
		expect(harmony?.controlChanges[tunnelCc]?.length).toBeGreaterThan(0);
	});
});

describe("player helpers", () => {
	it("finds the first note at or after a minute", () => {
		const { notes } = buildScore(
			makeDay([
				[10, 0, "boat", true],
				[20, 0, "boat", true],
			]),
			{
				durationS: 180,
				notesPerSecond: 30,
				pitchMapping: "rank",
			},
		);
		expect(firstNoteAtOrAfter(notes, 0)).toBe(0);
		expect(firstNoteAtOrAfter(notes, 15)).toBe(1);
		expect(firstNoteAtOrAfter(notes, 30)).toBe(notes.length);
	});
});

describe("day file", () => {
	it("rejects files of another schema version", () => {
		expect(() => assertContract<Day>({ ...makeDay([]), schema_version: 1 }, "day", [])).toThrow(/schema_version/);
	});

	it.skipIf(!existsSync(REAL_DAY))("real day stays within the note budget", () => {
		const data: unknown = JSON.parse(readFileSync(REAL_DAY, "utf8"));
		assertContract<Day>(data, "day", ["stations"]);
		for (const durationS of [180, 600, 1200]) {
			const score = buildScore(data, { durationS, notesPerSecond: 30, pitchMapping: "rank" });
			const rate = score.notes.length / durationS;
			expect(rate).toBeLessThanOrEqual(30);
			expect(rate).toBeGreaterThan(10);
			expect(score.notes.every((n) => n.minute >= 0 && n.minute < MINUTES_PER_DAY)).toBe(true);
		}
	});
});
