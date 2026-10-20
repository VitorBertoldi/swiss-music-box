import * as Tone from "tone";
import { recordOf } from "../music/collections";
import { NOTE_LAYERS, ZONES } from "../music/constants";
import { chordAt, voicing } from "../music/harmony";
import { zonePan } from "../music/space";
import type { Chord, Level, MidiNote, NoteLayer, ScoredNote, TextureLayer, Zone } from "../music/types";
import { type LevelChannel, levelChannelKey, type ScoreSink } from "./sink";
import { createDrone, createNoiseBed, createNoteVoice, createPad } from "./toneInstruments";

/** Peak linear gain of each continuous voice at level 1. */
const LEVEL_GAIN: Readonly<Record<TextureLayer | "tunnel", number>> = {
	regional_rail: 0.5,
	tram: 0.05,
	bus: 0.12,
	tunnel: 0.35,
};
const NOISE_BEDS = [
	["bus", "rain"],
	["tram", "shimmer"],
] as const;
const PAD_LOWEST_NOTE = 50;
const PAD_VOICES = 4;
const DRONE_LOWEST_NOTE = 26; // D1
const DRONE_GLIDE_S = 4;
const PITCH_CLASSES = 12;
const REVERB = { decay: 7, wet: 0.3 } as const;
const LIMITER_DB = -1;
const SILENCE_RAMP_S = 0.2;

/** The zero-setup browser synth (Tone.js). */
export class ToneOutput implements ScoreSink {
	private graph: Graph | undefined;

	async start(): Promise<void> {
		await Tone.start();
		this.graph ??= new Graph();
	}

	note(note: ScoredNote, atMs: number, lengthS: number): void {
		this.graph?.voices[note.layer][note.zone].triggerAttackRelease(
			hz(note.midi),
			lengthS,
			toToneTime(atMs),
			note.velocity,
		);
	}

	chord(chord: Chord, atMs: number): void {
		this.graph?.setChord(chord, toToneTime(atMs));
	}

	level(channel: LevelChannel, level: Level, atMs: number, rampMs: number): void {
		if (this.graph === undefined) return;
		const gain =
			channel.kind === "tunnel"
				? this.graph.tunnelGain(levelChannelKey(channel), channel.pan)
				: this.graph.levels.get(levelChannelKey(channel));
		const peak = LEVEL_GAIN[channel.kind === "texture" ? channel.layer : "tunnel"];
		gain?.gain.rampTo(level * peak, rampMs / 1000, toToneTime(atMs));
	}

	silence(): void {
		this.graph?.silence();
	}
}

/** The audio graph, built once the AudioContext is allowed to run. */
class Graph {
	readonly voices: Record<NoteLayer, Record<Zone, Tone.PolySynth>>;
	readonly levels = new Map<string, Tone.Gain>();
	private readonly master: Tone.Limiter;
	private readonly pads: Record<Zone, Tone.PolySynth>;
	private readonly drones: Tone.FatOscillator[] = [];
	private chord: Chord = chordAt(0);
	private padNotes: string[] = [];

	constructor() {
		this.master = new Tone.Limiter(LIMITER_DB).toDestination();
		const reverb = new Tone.Reverb(REVERB).connect(this.master);
		const panners = recordOf(ZONES, (zone) => new Tone.Panner(zonePan(zone)).connect(reverb));

		this.voices = recordOf(NOTE_LAYERS, (layer) =>
			recordOf(ZONES, (zone) => createNoteVoice(layer).connect(panners[zone])),
		);
		this.pads = recordOf(ZONES, (zone) =>
			createPad().connect(this.addLevel(`texture:regional_rail:${zone}`, panners[zone])),
		);
		for (const zone of ZONES) {
			for (const [layer, kind] of NOISE_BEDS) {
				const bed = createNoiseBed(kind);
				bed.output.connect(this.addLevel(`texture:${layer}:${zone}`, panners[zone]));
				bed.source.start();
			}
		}
	}

	/** The gain of a tunnel's drone, creating the drone on first use. */
	tunnelGain(key: string, pan: number): Tone.Gain {
		const existing = this.levels.get(key);
		if (existing !== undefined) return existing;
		const drone = createDrone();
		drone.oscillator.frequency.value = hz(droneRoot(this.chord));
		drone.output.connect(this.addLevel(key, new Tone.Panner(pan).connect(this.master)));
		drone.oscillator.start();
		this.drones.push(drone.oscillator);
		return this.levels.get(key) as Tone.Gain;
	}

	setChord(chord: Chord, time: number): void {
		this.chord = chord;
		const notes = voicing(chord, PAD_LOWEST_NOTE, PAD_VOICES).map((m) => Tone.Frequency(m, "midi").toNote());
		for (const pad of Object.values(this.pads)) {
			if (this.padNotes.length > 0) pad.triggerRelease(this.padNotes, time);
			pad.triggerAttack(notes, time);
		}
		this.padNotes = notes;
		for (const drone of this.drones) drone.frequency.rampTo(hz(droneRoot(chord)), DRONE_GLIDE_S, time);
	}

	silence(): void {
		const now = Tone.now();
		for (const byZone of Object.values(this.voices)) {
			for (const voice of Object.values(byZone)) voice.releaseAll(now);
		}
		for (const pad of Object.values(this.pads)) pad.releaseAll(now);
		this.padNotes = [];
		for (const gain of this.levels.values()) gain.gain.rampTo(0, SILENCE_RAMP_S, now);
	}

	private addLevel(key: string, destination: Tone.InputNode): Tone.Gain {
		const gain = new Tone.Gain(0).connect(destination);
		this.levels.set(key, gain);
		return gain;
	}
}

function droneRoot(chord: Chord): MidiNote {
	const offset = (((chord.root - DRONE_LOWEST_NOTE) % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
	return DRONE_LOWEST_NOTE + offset;
}

function hz(midi: MidiNote): number {
	return Tone.Frequency(midi, "midi").toFrequency();
}

/** performance.now() milliseconds -> AudioContext seconds. */
function toToneTime(atMs: number): number {
	return Tone.immediate() + Math.max(0, (atMs - performance.now()) / 1000);
}
