import type { Bounds } from "../contract/day";
import { ZONES } from "./constants";
import type { Pan, Zone } from "./types";

/** West-east position mapped to stereo: Genève hard left, Val Müstair hard right. */
export function panOf(easting: number, bounds: Bounds): Pan {
	const westToEast = (easting - bounds.min_easting_m) / (bounds.max_easting_m - bounds.min_easting_m);
	return Math.min(1, Math.max(-1, westToEast * 2 - 1));
}

/** Thirds of the stereo field. */
export function zoneOf(pan: Pan): Zone {
	const index = Math.min(ZONES.length - 1, Math.floor(((pan + 1) / 2) * ZONES.length));
	return ZONES[index] ?? "centre";
}

/** Stereo position at the centre of a zone. */
export function zonePan(zone: Zone): Pan {
	return ((ZONES.indexOf(zone) + 0.5) / ZONES.length) * 2 - 1;
}
