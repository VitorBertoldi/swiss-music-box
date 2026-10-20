import { DURATION_CHOICES_S } from "../music/constants";
import type { PitchMapping } from "../music/types";
import type { ChannelLayout } from "../outputs/midiMap";
import { element, option } from "./dom";

export interface Settings {
	readonly durationS: number;
	readonly pitchMapping: PitchMapping;
	readonly browserSynth: boolean;
	/** Web MIDI output port id, or null for none. */
	readonly midiPortId: string | null;
	readonly channelLayout: ChannelLayout;
}

export const DEFAULT_SETTINGS: Settings = {
	durationS: DURATION_CHOICES_S[0],
	pitchMapping: "rank",
	browserSynth: true,
	midiPortId: null,
	channelLayout: "per-layer",
};

const SECONDS_PER_MINUTE = 60;

/** Score and output settings; reports a complete `Settings` whenever one input changes. */
export class SettingsControls {
	private readonly duration = element("duration", HTMLSelectElement);
	private readonly mapping = element("mapping", HTMLSelectElement);
	private readonly browserSynth = element("synth", HTMLInputElement);
	private readonly midiPort = element("midi-port", HTMLSelectElement);
	private readonly layout = element("layout", HTMLSelectElement);

	constructor(midiPorts: readonly MIDIOutput[], onChange: (settings: Settings) => void, onExportMidi: () => void) {
		this.duration.replaceChildren(
			...DURATION_CHOICES_S.map((seconds) => option(String(seconds), `${seconds / SECONDS_PER_MINUTE} min`)),
		);
		this.midiPort.replaceChildren(
			option("", midiPorts.length > 0 ? "None" : "No MIDI ports"),
			...midiPorts.map((port) => option(port.id, port.name ?? port.id)),
		);
		for (const input of [this.duration, this.mapping, this.browserSynth, this.midiPort, this.layout]) {
			input.addEventListener("change", () => onChange(this.current()));
		}
		element("export", HTMLButtonElement).addEventListener("click", onExportMidi);
	}

	private current(): Settings {
		return {
			durationS: Number(this.duration.value),
			pitchMapping: this.mapping.value as PitchMapping,
			browserSynth: this.browserSynth.checked,
			midiPortId: this.midiPort.value === "" ? null : this.midiPort.value,
			channelLayout: this.layout.value as ChannelLayout,
		};
	}
}
