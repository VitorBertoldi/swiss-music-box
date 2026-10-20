import { MINUTES_PER_DAY } from "./constants";
import type { Chord, MidiNote, Minute } from "./types";

interface Section {
	readonly fromHour: number;
	readonly chord: Chord;
}

// Pitch classes: C=0 C#=1 D=2 D#=3 E=4 F=5 F#=6 G=7 G#=8 A=9 A#=10 B=11.
// A day in D: an open, sparse night, a brightening morning, a full evening rush, a calm close.
const PROGRESSION: readonly Section[] = [
	{ fromHour: 0, chord: { name: "Dsus2", root: 2, pitchClasses: [2, 4, 9] } },
	{ fromHour: 4, chord: { name: "Bm7(11)", root: 11, pitchClasses: [11, 2, 6, 9, 4] } },
	{ fromHour: 6, chord: { name: "Gmaj7", root: 7, pitchClasses: [7, 11, 2, 6] } },
	{ fromHour: 9, chord: { name: "Dadd9", root: 2, pitchClasses: [2, 6, 9, 4] } },
	{ fromHour: 12, chord: { name: "Asus4", root: 9, pitchClasses: [9, 2, 4] } },
	{ fromHour: 14, chord: { name: "Em9", root: 4, pitchClasses: [4, 7, 11, 2, 6] } },
	{ fromHour: 16, chord: { name: "G lydian", root: 7, pitchClasses: [7, 9, 11, 1, 2, 6] } },
	{ fromHour: 19, chord: { name: "F#m7", root: 6, pitchClasses: [6, 9, 1, 4] } },
	{ fromHour: 22, chord: { name: "Bm(add9)", root: 11, pitchClasses: [11, 2, 6, 1] } },
];

const MINUTES_PER_HOUR = 60;
const PITCH_CLASSES = 12;

export function chordAt(minute: Minute): Chord {
	const hour = (((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / MINUTES_PER_HOUR;
	let current = PROGRESSION[0];
	for (const section of PROGRESSION) {
		if (section.fromHour <= hour) current = section;
	}
	if (current === undefined) throw new Error("empty chord progression");
	return current.chord;
}

/** Minutes at which the chord changes, in order (the first is 0). */
export function chordChangeMinutes(): readonly Minute[] {
	return PROGRESSION.map((s) => s.fromHour * MINUTES_PER_HOUR);
}

/** The pitch closest to `midi` whose pitch class belongs to the chord (ties go down). */
export function snapToChord(midi: number, chord: Chord): MidiNote {
	const base = Math.round(midi);
	for (let distance = 0; distance < PITCH_CLASSES; distance++) {
		for (const candidate of [base - distance, base + distance]) {
			const pitchClass = ((candidate % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
			if (chord.pitchClasses.includes(pitchClass)) return candidate;
		}
	}
	return base;
}

/** Chord tones voiced upward from the root at or above `lowest`. */
export function voicing(chord: Chord, lowest: MidiNote, count: number): MidiNote[] {
	const firstRoot = lowest + ((((chord.root - lowest) % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES);
	const intervals = chord.pitchClasses
		.map((pc) => (pc - chord.root + PITCH_CLASSES) % PITCH_CLASSES)
		.sort((a, b) => a - b);
	const notes: MidiNote[] = [];
	for (let i = 0; notes.length < count; i++) {
		const octave = Math.floor(i / intervals.length);
		const interval = intervals[i % intervals.length] ?? 0;
		notes.push(firstRoot + octave * PITCH_CLASSES + interval);
	}
	return notes;
}
