import { Midi, type Track } from "@tonejs/midi";
import {
	MINUTES_PER_DAY,
	NOTE_LENGTH_S,
	REFERENCE_BPM,
	REFERENCE_DURATION_S,
	SIXTEENTHS_PER_BEAT,
	TEXTURE_LAYERS,
	ZONES,
} from "../music/constants";
import { chordAt, chordChangeMinutes, voicing } from "../music/harmony";
import type { Score } from "../music/types";
import {
	type ChannelLayout,
	HARMONY_CHANNEL,
	HARMONY_LOWEST_NOTE,
	HARMONY_VOICES,
	levelCc,
	noteChannel,
	noteTrackName,
} from "./midiMap";
import type { LevelChannel } from "./sink";

const SECONDS_PER_MINUTE = 60;
const HARMONY_VELOCITY = 0.6;
/** Only write a CC when the level moved at least this much (keeps clips light). */
const CC_RESOLUTION = 1 / 127;

export interface MidiExportOptions {
	readonly durationS: number;
	readonly layout: ChannelLayout;
}

/** Tempo at which one timetable minute is one 16th note and the day lasts `durationS`. */
export function tempoFor(durationS: number): number {
	return (REFERENCE_BPM * REFERENCE_DURATION_S) / durationS;
}

/** A Standard MIDI File of the whole day: drag it into Ableton, one track per voice. */
export function scoreToMidi(score: Score, options: MidiExportOptions): Uint8Array {
	const midi = new Midi();
	const bpm = tempoFor(options.durationS);
	midi.header.setTempo(bpm);
	midi.header.name = "Swiss Music Box";
	const ticksPerMinute = midi.header.ppq / SIXTEENTHS_PER_BEAT;
	const ticksPerSecond = (bpm / SECONDS_PER_MINUTE) * midi.header.ppq;

	const tracks = new Map<number, Track>();
	const trackFor = (channel: number, name: string): Track => {
		let track = tracks.get(channel);
		if (track === undefined) {
			track = midi.addTrack();
			track.name = name;
			track.channel = channel;
			tracks.set(channel, track);
		}
		return track;
	};

	for (const note of score.notes) {
		const channel = noteChannel(note.layer, note.zone, options.layout);
		trackFor(channel, noteTrackName(note.layer, note.zone, options.layout)).addNote({
			midi: note.midi,
			ticks: Math.round(note.minute * ticksPerMinute),
			durationTicks: Math.round(NOTE_LENGTH_S[note.layer] * ticksPerSecond),
			velocity: note.velocity,
		});
	}

	const harmony = trackFor(HARMONY_CHANNEL, "Harmony + levels (CC)");
	writeChords(harmony, ticksPerMinute);
	for (const [channel, levels] of levelSeries(score)) writeLevels(harmony, levelCc(channel), levels, ticksPerMinute);

	// Ableton lists tracks in file order; keep them in channel order.
	midi.tracks.sort((a, b) => a.channel - b.channel);
	return midi.toArray();
}

function writeChords(track: Track, ticksPerMinute: number): void {
	const starts = chordChangeMinutes();
	starts.forEach((start, i) => {
		const end = starts[i + 1] ?? MINUTES_PER_DAY;
		for (const midi of voicing(chordAt(start), HARMONY_LOWEST_NOTE, HARMONY_VOICES)) {
			track.addNote({
				midi,
				ticks: Math.round(start * ticksPerMinute),
				durationTicks: Math.round((end - start) * ticksPerMinute),
				velocity: HARMONY_VELOCITY,
			});
		}
	});
}

function* levelSeries(score: Score): Generator<[LevelChannel, Float32Array]> {
	for (const layer of TEXTURE_LAYERS) {
		for (const zone of ZONES) yield [{ kind: "texture", layer, zone }, score.textures[layer][zone]];
	}
	for (const [index, tunnel] of score.tunnels.entries()) {
		yield [{ kind: "tunnel", index, id: tunnel.id, pan: tunnel.pan }, tunnel.level];
	}
}

function writeLevels(track: Track, cc: number, levels: Float32Array, ticksPerMinute: number): void {
	let previous = Number.NaN;
	levels.forEach((value, minute) => {
		if (Math.abs(value - previous) < CC_RESOLUTION) return;
		track.addCC({ number: cc, value, ticks: Math.round(minute * ticksPerMinute) });
		previous = value;
	});
}
