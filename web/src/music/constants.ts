import type { MidiNote, NoteLayer, TextureLayer, Zone } from "./types";

export const MINUTES_PER_DAY = 1440;
export const SCHEMA_VERSION = 3;

/** At the reference length a timetable minute lasts exactly one 16th note at 120 BPM. */
export const REFERENCE_DURATION_S = 180;
export const REFERENCE_BPM = 120;
export const SIXTEENTHS_PER_BEAT = 4;

export const DURATION_CHOICES_S = [180, 600, 1200] as const;
export const DEFAULT_NOTES_PER_SECOND = 30;

export const NOTE_LAYERS: readonly NoteLayer[] = ["long_rail", "mountain_rail", "boat", "aerial", "funicular"];
export const TEXTURE_LAYERS: readonly TextureLayer[] = ["regional_rail", "tram", "bus"];
export const ZONES: readonly Zone[] = ["west", "centre", "east"];

export const LAYER_LABELS: Readonly<Record<NoteLayer | TextureLayer, string>> = {
	long_rail: "IC / IR trains",
	mountain_rail: "Mountain & rack railways",
	boat: "Boats",
	aerial: "Cable cars",
	funicular: "Funiculars",
	regional_rail: "S-Bahn / regional",
	tram: "Trams & metro",
	bus: "Buses",
};

/** Share of the note budget each layer may use. Sums to 1. */
export const BUDGET_SHARE: Readonly<Record<NoteLayer, number>> = {
	long_rail: 0.35,
	mountain_rail: 0.15,
	boat: 0.15,
	aerial: 0.2,
	funicular: 0.15,
};

/** MIDI range each layer's pitches are spread over, low station -> high station. */
export const REGISTER: Readonly<Record<NoteLayer, readonly [MidiNote, MidiNote]>> = {
	boat: [36, 60],
	long_rail: [48, 79],
	funicular: [55, 84],
	mountain_rail: [60, 91],
	aerial: [67, 96],
};

/** How long each note rings, in real seconds (independent of playback speed). */
export const NOTE_LENGTH_S: Readonly<Record<NoteLayer, number>> = {
	long_rail: 0.6,
	mountain_rail: 0.5,
	boat: 2.0,
	aerial: 1.6,
	funicular: 0.25,
};

/** Simultaneous departures within one minute are strummed across this part of it. */
export const STRUM_FRACTION = 0.6;

/** Occupancy at which a tunnel drone reaches full level. */
export const TUNNEL_FULL_OCCUPANCY = 3;
