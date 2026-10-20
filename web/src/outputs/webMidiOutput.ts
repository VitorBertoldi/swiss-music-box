import { voicing } from "../music/harmony";
import type { Chord, Level, ScoredNote } from "../music/types";
import {
	type ChannelLayout,
	HARMONY_CHANNEL,
	HARMONY_LOWEST_NOTE,
	HARMONY_VOICES,
	levelCc,
	noteChannel,
	toMidiValue,
	toMidiVelocity,
} from "./midiMap";
import type { LevelChannel, ScoreSink } from "./sink";

const HARMONY_VELOCITY = 80;

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const ALL_NOTES_OFF_CC = 123;
const MIDI_CHANNELS = 16;

/** Output ports offered by the browser (Chrome/Edge; Safari has no Web MIDI). */
export async function midiOutputs(): Promise<MIDIOutput[]> {
	if (!("requestMIDIAccess" in navigator)) return [];
	const access = await navigator.requestMIDIAccess();
	return [...access.outputs.values()];
}

/** Live MIDI, e.g. to the macOS IAC Driver and from there into Ableton Live. */
export class WebMidiOutput implements ScoreSink {
	private chordNotes: number[] = [];

	constructor(
		private readonly port: MIDIOutput,
		private readonly layout: ChannelLayout,
	) {}

	async start(): Promise<void> {
		await this.port.open();
	}

	note(note: ScoredNote, atMs: number, lengthS: number): void {
		const channel = noteChannel(note.layer, note.zone, this.layout);
		this.port.send([NOTE_ON | channel, note.midi, toMidiVelocity(note.velocity)], atMs);
		this.port.send([NOTE_OFF | channel, note.midi, 0], atMs + lengthS * 1000);
	}

	chord(chord: Chord, atMs: number): void {
		for (const midi of this.chordNotes) this.port.send([NOTE_OFF | HARMONY_CHANNEL, midi, 0], atMs);
		this.chordNotes = voicing(chord, HARMONY_LOWEST_NOTE, HARMONY_VOICES);
		for (const midi of this.chordNotes) {
			this.port.send([NOTE_ON | HARMONY_CHANNEL, midi, HARMONY_VELOCITY], atMs);
		}
	}

	level(channel: LevelChannel, level: Level, atMs: number): void {
		this.port.send([CONTROL_CHANGE | HARMONY_CHANNEL, levelCc(channel), toMidiValue(level)], atMs);
	}

	/** All-notes-off on every channel; notes already scheduled ahead (<150 ms) still arrive. */
	silence(): void {
		for (let channel = 0; channel < MIDI_CHANNELS; channel++) {
			this.port.send([CONTROL_CHANGE | channel, ALL_NOTES_OFF_CC, 0]);
		}
		this.chordNotes = [];
	}
}
