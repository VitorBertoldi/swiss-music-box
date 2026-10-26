import { bundleUrl } from "./assetBundles";

/**
 * Where the vector tiles and label glyphs come from. A strategy, chosen at start-up:
 * - `pmtiles`: one file with every zoom level, read with HTTP range requests (local server);
 *   glyphs are plain files;
 * - `bundle`: the low zoom levels and the glyphs packed into JSON bundles, for hosts that
 *   neither answer range requests nor serve protobuf files (the shared link).
 */
export type TileSource =
	| { readonly kind: "pmtiles"; readonly dataUrl: string; readonly maxZoom: number }
	| { readonly kind: "bundle"; readonly dataUrl: string; readonly maxZoom: number };

export const FULL_DETAIL_MAX_ZOOM = 14;
export const OVERVIEW_MAX_ZOOM = 10;

/** Fetches only the first byte; a server that understands ranges answers 206. */
export type RangeProbe = (url: string) => Promise<boolean>;

export const probeRangeRequests: RangeProbe = async (url) => {
	try {
		const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
		return response.status === 206;
	} catch {
		return false;
	}
};

/** Full detail when the PMTiles file is served with range support, otherwise the overview. */
export async function chooseTileSource(dataUrl: string, probe: RangeProbe = probeRangeRequests): Promise<TileSource> {
	return (await probe(pmtilesUrl(dataUrl)))
		? { kind: "pmtiles", dataUrl, maxZoom: FULL_DETAIL_MAX_ZOOM }
		: { kind: "bundle", dataUrl, maxZoom: OVERVIEW_MAX_ZOOM };
}

/** The tile URL template MapLibre should request. */
export function tileUrl(source: TileSource): string {
	return source.kind === "pmtiles"
		? `pmtiles://${pmtilesUrl(source.dataUrl)}/{z}/{x}/{y}`
		: bundleUrl(`${source.dataUrl}/overview-tiles/zoom-{z}.json`, "{x}/{y}");
}

/** The glyph URL template MapLibre should request. */
export function glyphsUrl(source: TileSource): string {
	return source.kind === "pmtiles"
		? `${source.dataUrl}/fonts/{fontstack}/{range}.pbf`
		: bundleUrl(`${source.dataUrl}/fonts/glyphs.json`, "{fontstack}/{range}");
}

/**
 * The terrain tile URL template, or null where the 3D terrain can't be served: its file needs
 * range requests, like the full map, so the shared link stays flat.
 */
export function terrainUrl(source: TileSource): string | null {
	return source.kind === "pmtiles"
		? `pmtiles://${source.dataUrl}/terrain/switzerland-terrain.pmtiles/{z}/{x}/{y}`
		: null;
}

function pmtilesUrl(dataUrl: string): string {
	return `${dataUrl}/tiles/switzerland.pmtiles`;
}
