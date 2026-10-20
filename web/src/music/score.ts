import type { Day, TextureSeries, TunnelSeries } from "../contract/day";
import { NoteBudget, notesPerMinute } from "./budget";
import { at, recordOf } from "./collections";
import {
	BUDGET_SHARE,
	MINUTES_PER_DAY,
	NOTE_LAYERS,
	REGISTER,
	STRUM_FRACTION,
	TEXTURE_LAYERS,
	TUNNEL_FULL_OCCUPANCY,
	ZONES,
} from "./constants";
import { chordAt, snapToChord } from "./harmony";
import { type AltitudeScale, altitudeScale, intoRange } from "./pitch";
import { panOf, zoneOf } from "./space";
import type { NoteLayer, Score, ScoredNote, ScoreSettings, TunnelLine } from "./types";

interface Candidate {
	readonly minute: number;
	readonly station: number;
	readonly layer: NoteLayer;
	readonly tripStart: boolean;
}

const MIN_VELOCITY = 0.35;
const TRIP_START_ACCENT = 0.15;

/** Applies the musical rules to a day. Pure: the same inputs always give the same score. */
export function buildScore(day: Day, settings: ScoreSettings): Score {
	return {
		notes: scoreNotes(day, settings),
		textures: scoreTextures(day.textures, day.texture_bins),
		tunnels: day.tunnels.map((t) => scoreTunnel(t, day)),
	};
}

function scoreNotes(day: Day, settings: ScoreSettings): ScoredNote[] {
	const scale = altitudeScale(
		day.stations.map((s) => s.elevation_m),
		settings.pitchMapping,
	);
	const hubWeight = stationWeights(day);
	const budgets = recordOf(
		NOTE_LAYERS,
		(layer) =>
			new NoteBudget(notesPerMinute(settings.notesPerSecond, BUDGET_SHARE[layer], settings.durationS, MINUTES_PER_DAY)),
	);
	// Trip starts first, then the busiest stations; station index breaks ties deterministically.
	const byPriority = (a: Candidate, b: Candidate): number =>
		Number(b.tripStart) - Number(a.tripStart) ||
		at(hubWeight, b.station) - at(hubWeight, a.station) ||
		a.station - b.station;

	const notes: ScoredNote[] = [];
	for (const [minute, candidates] of groupByMinute(day)) {
		const chosen = NOTE_LAYERS.flatMap((layer) =>
			budgets[layer].take(
				minute,
				candidates.filter((c) => c.layer === layer),
				byPriority,
			),
		).sort((a, b) => a.station - b.station);
		chosen.forEach((c, i) => {
			const strum = (i / chosen.length) * STRUM_FRACTION;
			notes.push(toNote(c, minute + strum, day, scale, hubWeight));
		});
	}
	return notes;
}

function toNote(
	c: Candidate,
	minute: number,
	day: Day,
	scale: AltitudeScale,
	hubWeight: readonly number[],
): ScoredNote {
	const station = at(day.stations, c.station);
	const pan = panOf(station.easting_m, day.bounds);
	const rawPitch = intoRange(scale(station.elevation_m), REGISTER[c.layer]);
	const loudness = MIN_VELOCITY + (1 - MIN_VELOCITY - TRIP_START_ACCENT) * at(hubWeight, c.station);
	return {
		minute,
		layer: c.layer,
		station: c.station,
		midi: snapToChord(rawPitch, chordAt(minute)),
		velocity: loudness + (c.tripStart ? TRIP_START_ACCENT : 0),
		pan,
		zone: zoneOf(pan),
	};
}

/** Log-scaled number of departures per station, normalised to 0..1 (busy hubs are louder). */
function stationWeights(day: Day): number[] {
	const counts = new Array<number>(day.stations.length).fill(0);
	for (const s of day.notes.station) counts[s] = at(counts, s) + 1;
	const max = Math.log1p(Math.max(1, ...counts));
	return counts.map((n) => Math.log1p(n) / max);
}

/** Note candidates grouped by minute; relies on the contract's sort order. */
function* groupByMinute(day: Day): Generator<[number, Candidate[]]> {
	const { minute, station, layer, trip_start } = day.notes;
	let current = -1;
	let group: Candidate[] = [];
	for (let i = 0; i < minute.length; i++) {
		const m = at(minute, i);
		if (m !== current && group.length > 0) {
			yield [current, group];
			group = [];
		}
		current = m;
		group.push({ minute: m, station: at(station, i), layer: at(layer, i), tripStart: at(trip_start, i) });
	}
	if (group.length > 0) yield [current, group];
}

function scoreTextures(series: readonly TextureSeries[], bins: number): Score["textures"] {
	const binZone = Array.from({ length: bins }, (_, b) => zoneOf(((b + 0.5) / bins) * 2 - 1));
	return recordOf(TEXTURE_LAYERS, (layer) => {
		const zones = recordOf(ZONES, () => new Float32Array(MINUTES_PER_DAY));
		const counts = series.find((s) => s.layer === layer)?.counts ?? [];
		counts.forEach((row, minute) => {
			row.forEach((count, bin) => {
				const zone = zones[at(binZone, bin)];
				zone[minute] = at(zone, minute) + count;
			});
		});
		normaliseTogether(Object.values(zones));
		return zones;
	});
}

/** Scales arrays by their common maximum, so zones of one layer stay comparable. */
function normaliseTogether(arrays: readonly Float32Array[]): void {
	const max = Math.max(1, ...arrays.map((a) => a.reduce((m, x) => Math.max(m, x), 0)));
	for (const a of arrays) {
		for (let i = 0; i < a.length; i++) a[i] = at(a, i) / max;
	}
}

function scoreTunnel(tunnel: TunnelSeries, day: Day): TunnelLine {
	const pan = panOf(tunnel.easting_m, day.bounds);
	return {
		id: tunnel.id,
		name: tunnel.name,
		pan,
		zone: zoneOf(pan),
		level: Float32Array.from(tunnel.occupancy, (n) => Math.min(1, n / TUNNEL_FULL_OCCUPANCY)),
	};
}
