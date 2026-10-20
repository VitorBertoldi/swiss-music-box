/** Sound design for the browser synth: one factory per voice. Tweak freely. */
import * as Tone from "tone";
import type { NoteLayer } from "../music/types";

// Bells and boat horns ring for ~3-4 s; 16 voices per layer and zone covers rush-hour bursts.
const MAX_POLYPHONY = 16;

type NoteVoice = Tone.PolySynth;

const NOTE_VOICES: Readonly<Record<NoteLayer, () => NoteVoice>> = {
	// Electric-piano-like FM: the backbone of the piece.
	long_rail: () =>
		new Tone.PolySynth(Tone.FMSynth, {
			harmonicity: 3,
			modulationIndex: 8,
			envelope: { attack: 0.005, decay: 0.8, sustain: 0.1, release: 0.8 },
			modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.3 },
			volume: -14,
		}),
	// Bright, glassy: trains climbing to the high stations.
	mountain_rail: () =>
		new Tone.PolySynth(Tone.AMSynth, {
			harmonicity: 2,
			envelope: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 0.6 },
			volume: -16,
		}),
	// Soft low horn: slow attack, long release.
	boat: () =>
		new Tone.PolySynth(Tone.FMSynth, {
			harmonicity: 1,
			modulationIndex: 2,
			oscillator: { type: "sine" },
			envelope: { attack: 0.25, decay: 0.5, sustain: 0.7, release: 1.8 },
			volume: -12,
		}),
	// Bells: inharmonic FM ratio and a long decay.
	aerial: () =>
		new Tone.PolySynth(Tone.FMSynth, {
			harmonicity: 3.07,
			modulationIndex: 14,
			envelope: { attack: 0.001, decay: 1.6, sustain: 0, release: 1.6 },
			modulationEnvelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.8 },
			volume: -20,
		}),
	// Short pluck.
	funicular: () =>
		new Tone.PolySynth(Tone.Synth, {
			oscillator: { type: "triangle" },
			envelope: { attack: 0.002, decay: 0.15, sustain: 0, release: 0.1 },
			volume: -14,
		}),
};

export function createNoteVoice(layer: NoteLayer): NoteVoice {
	const voice = NOTE_VOICES[layer]();
	voice.maxPolyphony = MAX_POLYPHONY;
	return voice;
}

/** Sustained chord for the S-Bahn texture. */
export function createPad(): Tone.PolySynth {
	return new Tone.PolySynth(Tone.Synth, {
		oscillator: { type: "fatsine", count: 3, spread: 20 },
		envelope: { attack: 2.5, decay: 0, sustain: 1, release: 3 },
		volume: -10,
	});
}

/** Filtered noise: "rain" for buses (pink, low) and "shimmer" for trams (white, high). */
export function createNoiseBed(kind: "rain" | "shimmer"): { source: Tone.Noise; output: Tone.Filter } {
	const source = new Tone.Noise(kind === "rain" ? "pink" : "white");
	const output =
		kind === "rain"
			? new Tone.Filter({ type: "lowpass", frequency: 900, Q: 0.7 })
			: new Tone.Filter({ type: "bandpass", frequency: 7000, Q: 1.5 });
	source.connect(output);
	return { source, output };
}

/** Low drone for a tunnel; its pitch follows the chord root. */
export function createDrone(): { oscillator: Tone.FatOscillator; output: Tone.Filter } {
	const oscillator = new Tone.FatOscillator({ type: "sawtooth", count: 3, spread: 15, frequency: 55 });
	const output = new Tone.Filter({ type: "lowpass", frequency: 260, Q: 2 });
	oscillator.connect(output);
	return { oscillator, output };
}
