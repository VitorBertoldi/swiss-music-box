import type { Chord, Level, ScoredNote, TextureLayer, Zone } from "../music/types";

/** A continuously varying voice: a texture layer in one zone, or a tunnel drone. */
export type LevelChannel =
	| { readonly kind: "texture"; readonly layer: TextureLayer; readonly zone: Zone }
	| { readonly kind: "tunnel"; readonly index: number; readonly id: string; readonly pan: number };

/**
 * Something that turns a score into sound: the browser synth, a live MIDI port, ...
 * All times are in the `performance.now()` clock, in milliseconds.
 */
export interface ScoreSink {
	/** Called from a user gesture before the first event (browsers require it for audio/MIDI). */
	start(): Promise<void>;
	note(note: ScoredNote, atMs: number, lengthS: number): void;
	chord(chord: Chord, atMs: number): void;
	level(channel: LevelChannel, level: Level, atMs: number, rampMs: number): void;
	/** Stop every sounding voice now (pause, seek). */
	silence(): void;
}

export function levelChannelKey(channel: LevelChannel): string {
	return channel.kind === "texture" ? `texture:${channel.layer}:${channel.zone}` : `tunnel:${channel.id}`;
}
