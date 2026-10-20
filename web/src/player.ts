import { at } from "./music/collections";
import { MINUTES_PER_DAY, NOTE_LENGTH_S, TEXTURE_LAYERS, ZONES } from "./music/constants";
import { chordAt } from "./music/harmony";
import type { Chord, Minute, NoteLayer, Score, ScoredNote, TextureLayer } from "./music/types";
import { type LevelChannel, levelChannelKey, type ScoreSink } from "./outputs/sink";

/** Anything that can be muted. */
export type Voice = NoteLayer | TextureLayer | "tunnels";

export type NoteListener = (note: ScoredNote, atMs: number) => void;

const TICK_MS = 25;
const LOOKAHEAD_MS = 150;
/** Smallest level change worth sending (MIDI resolution is 1/127). */
const LEVEL_EPSILON = 0.008;
const RATE_WINDOW_MS = 1000;

/**
 * Plays a score on a set of sinks with a look-ahead scheduler: a timer wakes every 25 ms and
 * schedules everything due in the next 150 ms with exact timestamps, so timing never depends
 * on timer jitter. Time is an ever-increasing "absolute minute"; the day loops.
 */
export class Player {
	private sinks: readonly ScoreSink[] = [];
	private readonly muted = new Set<Voice>();
	private readonly listeners = new Set<NoteListener>();
	private timer: ReturnType<typeof setInterval> | undefined;

	private anchorMs = 0;
	private anchorMinute = 0;
	private scheduledUntil = 0;
	private noteCursor = 0;
	private cursorDay = 0;
	private lastChord: Chord | undefined;
	private readonly lastLevels = new Map<string, number>();
	private readonly recentNotes: number[] = [];

	constructor(
		private score: Score,
		private durationS: number,
	) {}

	get playing(): boolean {
		return this.timer !== undefined;
	}

	/** Current minute of the day (fractional). */
	get minute(): Minute {
		return mod(this.absoluteMinuteAt(performance.now()), MINUTES_PER_DAY);
	}

	/** Notes sent during the last second. */
	notesPerSecond(): number {
		const now = performance.now();
		while ((this.recentNotes[0] ?? now) < now - RATE_WINDOW_MS) this.recentNotes.shift();
		// Notes are scheduled slightly ahead; only count those already heard.
		return this.recentNotes.filter((t) => t <= now).length;
	}

	onNote(listener: NoteListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async setSinks(sinks: readonly ScoreSink[]): Promise<void> {
		for (const sink of this.sinks) sink.silence();
		await Promise.all(sinks.map((s) => s.start()));
		this.sinks = sinks;
		this.restartFrom(this.absoluteMinuteAt(performance.now()));
	}

	play(): void {
		if (this.playing) return;
		this.timer = setInterval(() => this.tick(), TICK_MS);
		this.restartFrom(this.anchorMinute);
		this.tick();
	}

	pause(): void {
		if (!this.playing) return;
		this.anchorMinute = this.absoluteMinuteAt(performance.now());
		clearInterval(this.timer);
		this.timer = undefined;
		for (const sink of this.sinks) sink.silence();
	}

	seek(minute: Minute): void {
		for (const sink of this.sinks) sink.silence();
		this.restartFrom(mod(minute, MINUTES_PER_DAY));
	}

	/** Swap in a new score (e.g. a different length or pitch mapping) without losing the position. */
	setScore(score: Score, durationS: number): void {
		const position = this.absoluteMinuteAt(performance.now());
		this.score = score;
		this.durationS = durationS;
		this.restartFrom(position);
	}

	setMuted(voice: Voice, muted: boolean): void {
		if (muted) this.muted.add(voice);
		else this.muted.delete(voice);
		this.lastLevels.clear();
	}

	private get msPerMinute(): number {
		return (this.durationS * 1000) / MINUTES_PER_DAY;
	}

	private absoluteMinuteAt(ms: number): number {
		return this.playing ? this.anchorMinute + (ms - this.anchorMs) / this.msPerMinute : this.anchorMinute;
	}

	private msAt(absoluteMinute: number): number {
		return this.anchorMs + (absoluteMinute - this.anchorMinute) * this.msPerMinute;
	}

	private restartFrom(absoluteMinute: number): void {
		this.anchorMs = performance.now();
		this.anchorMinute = absoluteMinute;
		this.scheduledUntil = absoluteMinute;
		this.cursorDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
		this.noteCursor = firstNoteAtOrAfter(this.score.notes, mod(absoluteMinute, MINUTES_PER_DAY));
		if (this.noteCursor === this.score.notes.length) {
			this.noteCursor = 0;
			this.cursorDay++;
		}
		this.lastChord = undefined;
		this.lastLevels.clear();
		if (this.playing) this.sendState(absoluteMinute, this.anchorMs);
	}

	private tick(): void {
		const horizon = this.absoluteMinuteAt(performance.now() + LOOKAHEAD_MS);
		this.scheduleNotes(horizon);
		for (let m = Math.ceil(this.scheduledUntil); m < horizon; m++) this.sendState(m, this.msAt(m));
		this.scheduledUntil = horizon;
	}

	private scheduleNotes(until: number): void {
		const notes = this.score.notes;
		if (notes.length === 0) return;
		for (;;) {
			const note = at(notes, this.noteCursor);
			const absolute = this.cursorDay * MINUTES_PER_DAY + note.minute;
			if (absolute >= until) return;
			if (!this.muted.has(note.layer)) this.emit(note, this.msAt(absolute));
			this.noteCursor++;
			if (this.noteCursor === notes.length) {
				this.noteCursor = 0;
				this.cursorDay++;
			}
		}
	}

	private emit(note: ScoredNote, atMs: number): void {
		const lengthS = NOTE_LENGTH_S[note.layer];
		for (const sink of this.sinks) sink.note(note, atMs, lengthS);
		for (const listener of this.listeners) listener(note, atMs);
		this.recentNotes.push(atMs);
	}

	/** Chord and continuous levels at the start of a minute. */
	private sendState(absoluteMinute: number, atMs: number): void {
		const minute = mod(Math.floor(absoluteMinute), MINUTES_PER_DAY);
		const chord = chordAt(minute);
		if (chord !== this.lastChord) {
			for (const sink of this.sinks) sink.chord(chord, atMs);
			this.lastChord = chord;
		}
		for (const [channel, level] of this.levelsAt(minute)) {
			const key = levelChannelKey(channel);
			if (Math.abs(level - (this.lastLevels.get(key) ?? -1)) < LEVEL_EPSILON) continue;
			for (const sink of this.sinks) sink.level(channel, level, atMs, this.msPerMinute);
			this.lastLevels.set(key, level);
		}
	}

	private *levelsAt(minute: number): Generator<[LevelChannel, number]> {
		for (const layer of TEXTURE_LAYERS) {
			const muted = this.muted.has(layer);
			for (const zone of ZONES) {
				yield [{ kind: "texture", layer, zone }, muted ? 0 : at(this.score.textures[layer][zone], minute)];
			}
		}
		const tunnelsMuted = this.muted.has("tunnels");
		for (const [index, t] of this.score.tunnels.entries()) {
			yield [{ kind: "tunnel", index, id: t.id, pan: t.pan }, tunnelsMuted ? 0 : at(t.level, minute)];
		}
	}
}

function mod(x: number, m: number): number {
	return ((x % m) + m) % m;
}

/** Index of the first note at or after `minute`, or `notes.length` (binary search). */
export function firstNoteAtOrAfter(notes: readonly ScoredNote[], minute: Minute): number {
	let lo = 0;
	let hi = notes.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (at(notes, mid).minute < minute) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
