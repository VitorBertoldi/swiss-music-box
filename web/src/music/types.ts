import type { NoteEvents, TextureSeries } from "../contract/day";

/** Sparse layers: every departure can become a note. */
export type NoteLayer = NoteEvents["layer"][number];
/** Dense layers: only their activity level is heard. */
export type TextureLayer = TextureSeries["layer"];

/** Minute of the service day; fractional while playing (0 <= m < 1440). */
export type Minute = number;
/** MIDI note number, 0..127. */
export type MidiNote = number;
/** Stereo position, -1 (west) .. 1 (east). */
export type Pan = number;
/** Normalised intensity, 0..1. */
export type Level = number;

export type Zone = "west" | "centre" | "east";

export type PitchMapping = "linear" | "log" | "rank";

export interface Chord {
	readonly name: string;
	/** Pitch class of the root, 0 = C. */
	readonly root: number;
	/** Pitch classes allowed for melody notes, 0 = C. */
	readonly pitchClasses: readonly number[];
}

export interface ScoredNote {
	readonly minute: Minute;
	readonly layer: NoteLayer;
	readonly station: number;
	readonly midi: MidiNote;
	readonly velocity: Level;
	readonly pan: Pan;
	readonly zone: Zone;
}

export interface TunnelLine {
	readonly id: string;
	readonly name: string;
	readonly pan: Pan;
	readonly zone: Zone;
	/** level[minute] */
	readonly level: Float32Array;
}

/** What should be heard: the result of applying the musical rules to a day. */
export interface Score {
	/** Sorted by minute. */
	readonly notes: readonly ScoredNote[];
	/** textures[layer][zone][minute] */
	readonly textures: Readonly<Record<TextureLayer, Readonly<Record<Zone, Float32Array>>>>;
	readonly tunnels: readonly TunnelLine[];
}

export interface ScoreSettings {
	/** Length of the whole day in real seconds. */
	readonly durationS: number;
	/** Upper bound of notes per real second, across all note layers. */
	readonly notesPerSecond: number;
	readonly pitchMapping: PitchMapping;
}
