import { LAYER_LABELS, NOTE_LAYERS, TEXTURE_LAYERS } from "../music/constants";
import type { Voice } from "../player";
import type { Palette } from "../render/palette";
import { toCss } from "../render/palette";
import { element } from "./dom";

const VOICES: readonly Voice[] = [...NOTE_LAYERS, ...TEXTURE_LAYERS, "tunnels"];

/** One checkbox per voice; unchecking mutes it. */
export class VoiceToggles {
	constructor(palette: Palette, onMute: (voice: Voice, isMuted: boolean) => void) {
		const container = element("voices", HTMLElement);
		for (const voice of VOICES) {
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = true;
			checkbox.id = `voice-${voice}`;
			checkbox.addEventListener("change", () => onMute(voice, !checkbox.checked));
			const swatch = document.createElement("span");
			swatch.className = "swatch";
			swatch.style.background = swatchColour(voice, palette);
			const label = document.createElement("label");
			label.append(checkbox, swatch, voice === "tunnels" ? "Tunnel drones" : LAYER_LABELS[voice]);
			container.append(label);
		}
	}
}

function swatchColour(voice: Voice, palette: Palette): string {
	if (voice === "tunnels") return toCss(palette.tunnelGlow);
	if (voice === "tram" || voice === "bus") return "transparent";
	return toCss(palette.vehicles[voice]);
}
