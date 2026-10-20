/**
 * How the score is laid out on MIDI, shared by the live output and the .mid export.
 *
 * - Note layers get their own channels: one per layer, or one per layer and stereo zone.
 * - Channel 16 ("harmony") holds the current chord as long notes, and carries every
 *   continuous level as a CC: map them with MIDI Learn in Ableton (pad volume, filter, ...).
 */
import { LAYER_LABELS, NOTE_LAYERS, TEXTURE_LAYERS, ZONES } from "../music/constants";
import type { Level, NoteLayer, Zone } from "../music/types";
import type { LevelChannel } from "./sink";

export type ChannelLayout = "per-layer" | "per-layer-and-zone";

/** 0-based; shown as channel 16 in Ableton. */
export const HARMONY_CHANNEL = 15;
export const HARMONY_LOWEST_NOTE = 50;
export const HARMONY_VOICES = 4;

const TEXTURE_CC_BASE = 20; // 20..28: layer x zone
const TUNNEL_CC_BASE = 30; // 30..: one per tunnel
const MAX_MIDI_VALUE = 127;

export function noteChannel(layer: NoteLayer, zone: Zone, layout: ChannelLayout): number {
	const layerIndex = NOTE_LAYERS.indexOf(layer);
	return layout === "per-layer" ? layerIndex : layerIndex * ZONES.length + ZONES.indexOf(zone);
}

export function noteTrackName(layer: NoteLayer, zone: Zone, layout: ChannelLayout): string {
	return layout === "per-layer" ? LAYER_LABELS[layer] : `${LAYER_LABELS[layer]} · ${zone}`;
}

export function levelCc(channel: LevelChannel): number {
	return channel.kind === "texture"
		? TEXTURE_CC_BASE + TEXTURE_LAYERS.indexOf(channel.layer) * ZONES.length + ZONES.indexOf(channel.zone)
		: TUNNEL_CC_BASE + channel.index;
}

export function toMidiVelocity(velocity: Level): number {
	return Math.max(1, Math.min(MAX_MIDI_VALUE, Math.round(velocity * MAX_MIDI_VALUE)));
}

export function toMidiValue(level: Level): number {
	return Math.max(0, Math.min(MAX_MIDI_VALUE, Math.round(level * MAX_MIDI_VALUE)));
}
