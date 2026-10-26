import { describe, expect, it } from "vitest";
import type { Relief } from "../src/contract/relief";
import { AssetBundleLoader, bundleUrl, decodeBase64, parseBundleUrl } from "../src/map/assetBundles";
import { buildStyle, FIRST_LABEL_LAYER, LAYER_GROUP_KEY, TILES_SOURCE } from "../src/map/style";
import { chooseTileSource, glyphsUrl, type TileSource, tileUrl } from "../src/map/tileSource";
import { SCREEN_PALETTE } from "../src/render/palette";

const relief: Relief = {
	schema_version: 4,
	image: "relief.png",
	west: 5.9,
	south: 45.8,
	east: 10.5,
	north: 47.8,
	attribution: "test",
};
const pmtiles: TileSource = { kind: "pmtiles", dataUrl: "https://host/data", maxZoom: 14 };
const bundle: TileSource = { kind: "bundle", dataUrl: "https://host/data", maxZoom: 10 };
const style = buildStyle({
	colours: SCREEN_PALETTE.map,
	tiles: pmtiles,
	relief,
	reliefUrl: "https://host/data/relief.png",
});

describe("tile source", () => {
	it("uses the full PMTiles file when the server answers range requests", async () => {
		expect(await chooseTileSource("https://host/data", async () => true)).toEqual(pmtiles);
	});

	it("falls back to bundled overview tiles otherwise", async () => {
		expect(await chooseTileSource("https://host/data", async () => false)).toEqual(bundle);
	});

	it("addresses tiles and glyphs inside bundles", () => {
		expect(tileUrl(bundle)).toBe("bundle://https://host/data/overview-tiles/zoom-{z}.json?entry={x}/{y}");
		expect(glyphsUrl(bundle)).toBe("bundle://https://host/data/fonts/glyphs.json?entry={fontstack}/{range}");
		expect(glyphsUrl(pmtiles)).toBe("https://host/data/fonts/{fontstack}/{range}.pbf");
	});
});

describe("asset bundles", () => {
	it("splits a bundle URL into file and decoded entry name", () => {
		const url = bundleUrl("https://host/data/fonts/glyphs.json", "Noto%20Sans%20Regular/0-255");
		expect(parseBundleUrl(url)).toEqual({
			fileUrl: "https://host/data/fonts/glyphs.json",
			entry: "Noto Sans Regular/0-255",
		});
	});

	it("loads each bundle once and decodes entries; missing entries are null", async () => {
		const requested: string[] = [];
		const loader = new AssetBundleLoader(async (url) => {
			requested.push(url);
			return { schema_version: 4, entries: { "1/2": btoa("tile") } };
		});
		const tile = await loader.entry({ fileUrl: "zoom-3.json", entry: "1/2" });
		expect(new TextDecoder().decode(tile ?? new ArrayBuffer(0))).toBe("tile");
		expect(await loader.entry({ fileUrl: "zoom-3.json", entry: "9/9" })).toBeNull();
		expect(requested).toEqual(["zoom-3.json"]);
		expect(decodeBase64(btoa("ab")).byteLength).toBe(2);
	});

	it("rejects files that are not bundles of this schema version", async () => {
		const loader = new AssetBundleLoader(async () => ({ schema_version: 2, entries: {} }));
		await expect(loader.entry({ fileUrl: "old.json", entry: "x" })).rejects.toThrow(/asset bundle/);
	});
});

describe("map style", () => {
	const layer = (id: string) => style.layers.find((candidate) => candidate.id === id);

	it("reads our vector tiles through the PMTiles protocol, with local glyphs", () => {
		expect(style.sources[TILES_SOURCE]).toMatchObject({
			tiles: ["pmtiles://https://host/data/tiles/switzerland.pmtiles/{z}/{x}/{y}"],
			maxzoom: 14,
		});
		expect(style.glyphs).toBe("https://host/data/fonts/{fontstack}/{range}.pbf");
	});

	it("extrudes buildings from street-level zooms", () => {
		expect(layer("buildings")).toMatchObject({ type: "fill-extrusion", "source-layer": "building", minzoom: 13 });
	});

	it("draws paths, footways and cycleways, and labels streets", () => {
		expect(layer("road-path")).toBeDefined();
		expect(layer(FIRST_LABEL_LAYER)).toMatchObject({ type: "symbol", "source-layer": "transportation_name" });
	});

	it("puts every label above every line and fill", () => {
		const firstLabel = style.layers.findIndex((candidate) => candidate.type === "symbol");
		const lastNonLabel = style.layers.findLastIndex((candidate) => candidate.type !== "symbol");
		expect(style.layers[firstLabel]?.id).toBe(FIRST_LABEL_LAYER);
		expect(lastNonLabel).toBeLessThan(firstLabel);
	});

	it("tags every layer with a group so scenes can show only the outline", () => {
		for (const candidate of style.layers) {
			expect((candidate.metadata as Record<string, string>)[LAYER_GROUP_KEY]).toMatch(/ground|detail|orientation/);
		}
	});
});
