import type { Day } from "../contract/day";
import type { Motion } from "../contract/motion";
import type { Relief } from "../contract/relief";
import { chooseTileSource, type TileSource } from "../map/tileSource";
import { SCHEMA_VERSION } from "../music/constants";

/** Everything a performance needs: the three pipeline files and where the map tiles are. */
export interface ShowData {
	readonly day: Day;
	readonly motion: Motion;
	readonly relief: Relief;
	readonly reliefUrl: string;
	/** Where tiles and glyphs come from; URLs are absolute, as MapLibre needs. */
	readonly tiles: TileSource;
}

export async function loadShowData(dataUrl: string, serviceDate: string): Promise<ShowData> {
	const absoluteDataUrl = new URL(dataUrl, document.baseURI).href.replace(/\/$/, "");
	const [day, motion, relief, tiles] = await Promise.all([
		fetchJson(`${absoluteDataUrl}/${serviceDate}.json`),
		fetchJson(`${absoluteDataUrl}/motion-${serviceDate}.json`),
		fetchJson(`${absoluteDataUrl}/relief.json`),
		chooseTileSource(absoluteDataUrl),
	]);
	assertContract<Day>(day, "day", ["stations", "textures", "tunnels"]);
	assertContract<Motion>(motion, "motion", ["segments", "tunnels"]);
	assertContract<Relief>(relief, "relief", []);
	return {
		day,
		motion,
		relief,
		reliefUrl: `${absoluteDataUrl}/${relief.image}`,
		tiles,
	};
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`could not load ${url}: HTTP ${response.status}. Run "make data" first.`);
	return response.json();
}

/**
 * Cheap structural check at the trust boundary. The full contract is enforced by Pydantic
 * when the files are written; here we only guard against stale or foreign files.
 */
export function assertContract<T>(value: unknown, file: string, arrayKeys: readonly string[]): asserts value is T {
	if (typeof value !== "object" || value === null) throw new Error(`${file} file is not an object`);
	const record = value as Record<string, unknown>;
	if (record.schema_version !== SCHEMA_VERSION) {
		throw new Error(
			`${file} file has schema_version ${String(record.schema_version)}, expected ${SCHEMA_VERSION}: rebuild it with "make data"`,
		);
	}
	for (const key of arrayKeys) {
		if (!Array.isArray(record[key])) throw new Error(`${file} file: "${key}" must be an array`);
	}
}
