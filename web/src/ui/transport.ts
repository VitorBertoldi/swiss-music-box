import { element } from "./dom";

export interface TransportDisplay {
	readonly minute: number;
	readonly isPlaying: boolean;
	readonly chord: string;
	readonly notesPerSecond: number;
	readonly caption: string | null;
}

const MINUTES_PER_HOUR = 60;

/** Play/pause, the time scrubber, and the clock read-out. */
export class TransportControls {
	private isScrubbing = false;
	private readonly playButton = element("play", HTMLButtonElement);
	private readonly scrubber = element("scrub", HTMLInputElement);
	private readonly clock = element("clock", HTMLElement);
	private readonly chord = element("chord", HTMLElement);
	private readonly rate = element("rate", HTMLElement);
	private readonly caption = element("caption", HTMLElement);

	constructor(onTogglePlay: () => void, onSeek: (minute: number) => void) {
		this.playButton.addEventListener("click", onTogglePlay);
		this.scrubber.addEventListener("pointerdown", () => {
			this.isScrubbing = true;
		});
		this.scrubber.addEventListener("change", () => {
			this.isScrubbing = false;
			onSeek(this.scrubber.valueAsNumber);
		});
	}

	update(display: TransportDisplay): void {
		this.playButton.textContent = display.isPlaying ? "Pause" : "Play";
		this.clock.textContent = formatTime(display.minute);
		this.chord.textContent = display.chord;
		this.rate.textContent = `${display.notesPerSecond} notes/s`;
		this.caption.textContent = display.caption ?? "";
		if (!this.isScrubbing) this.scrubber.valueAsNumber = display.minute;
	}
}

export function formatTime(minute: number): string {
	const wholeMinute = Math.floor(minute);
	const hours = String(Math.floor(wholeMinute / MINUTES_PER_HOUR)).padStart(2, "0");
	const minutes = String(wholeMinute % MINUTES_PER_HOUR).padStart(2, "0");
	return `${hours}:${minutes}`;
}
