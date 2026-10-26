import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { Relief } from "../contract/relief";
import { type MapColours, type Rgba, toCss } from "../render/palette";
import { glyphsUrl, type TileSource, terrainUrl, tileUrl } from "./tileSource";

/** Layers are grouped so a scene can show the whole map, or only its outline. */
export type LayerGroup = "ground" | "detail" | "orientation";
export const LAYER_GROUP_KEY = "smb:group";

export interface StyleInputs {
	readonly colours: MapColours;
	readonly tiles: TileSource;
	readonly relief: Relief;
	readonly reliefUrl: string;
}

export const TILES_SOURCE = "openmaptiles";
const RELIEF_SOURCE = "relief";
/** Heights the map is raised over in 3D (Terrarium PNGs built by `make terrain`). */
export const TERRAIN_SOURCE = "terrain";
const TERRAIN_MAX_ZOOM = 11;
const TERRAIN_TILE_SIZE_PX = 256;
const TILES_ATTRIBUTION = "© OpenMapTiles © OpenStreetMap contributors";
/** The first label layer: vehicles are drawn just below it, so names stay readable. */
export const FIRST_LABEL_LAYER = "label-road";
const REGULAR_FONT = ["Noto Sans Regular"];
const BOLD_FONT = ["Noto Sans Bold"];
const ITALIC_FONT = ["Noto Sans Italic"];
/** OpenMapTiles stores the local name; Swiss names are already local. */
const NAME: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];
// Above these zooms the map's own detail replaces the relief and the street network appears.
const RELIEF_FADE_ZOOMS = [9, 12.5] as const;
const BUILDING_MIN_ZOOM = 13;
const FLOOR_HEIGHT_M = 3; // fallback when OSM has no height for a building

/** A complete MapLibre style for our tiles, colours and relief. */
export function buildStyle(inputs: StyleInputs): StyleSpecification {
	const { colours } = inputs;
	const terrainTiles = terrainUrl(inputs.tiles);
	return {
		version: 8,
		glyphs: glyphsUrl(inputs.tiles),
		sources: {
			[TILES_SOURCE]: {
				type: "vector",
				tiles: [tileUrl(inputs.tiles)],
				maxzoom: inputs.tiles.maxZoom,
				attribution: TILES_ATTRIBUTION,
			},
			[RELIEF_SOURCE]: {
				type: "image",
				url: inputs.reliefUrl,
				coordinates: [
					[inputs.relief.west, inputs.relief.north],
					[inputs.relief.east, inputs.relief.north],
					[inputs.relief.east, inputs.relief.south],
					[inputs.relief.west, inputs.relief.south],
				],
			},
			...(terrainTiles === null
				? {}
				: {
						[TERRAIN_SOURCE]: {
							type: "raster-dem",
							tiles: [terrainTiles],
							encoding: "terrarium",
							tileSize: TERRAIN_TILE_SIZE_PX,
							maxzoom: TERRAIN_MAX_ZOOM,
						},
					}),
		},
		layers: [
			...groundLayers(colours),
			...detailLayers(colours),
			...orientationLayers(colours),
			...labelLayers(colours),
		],
	};
}

function groundLayers(colours: MapColours): LayerSpecification[] {
	return [
		{
			id: "background",
			type: "background",
			paint: { "background-color": toCss(colours.background) },
			...group("ground"),
		},
		{
			id: "relief",
			type: "raster",
			source: RELIEF_SOURCE,
			paint: {
				"raster-opacity": [
					"interpolate",
					["linear"],
					["zoom"],
					RELIEF_FADE_ZOOMS[0],
					colours.reliefOpacity,
					RELIEF_FADE_ZOOMS[1],
					0.08,
				],
				"raster-fade-duration": 0,
			},
			...group("detail"),
		},
	];
}

function detailLayers(colours: MapColours): LayerSpecification[] {
	return [
		fill("landcover-wood", "landcover", ["==", ["get", "class"], "wood"], colours.wood),
		fill("landcover-grass", "landcover", ["in", ["get", "class"], ["literal", ["grass", "wetland"]]], colours.grass),
		fill("landcover-farmland", "landcover", ["==", ["get", "class"], "farmland"], colours.farmland),
		fill("landcover-rock", "landcover", ["in", ["get", "class"], ["literal", ["rock", "sand"]]], colours.rock),
		fill("landcover-ice", "landcover", ["==", ["get", "class"], "ice"], colours.ice),
		fill(
			"landuse-residential",
			"landuse",
			["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]],
			colours.residential,
		),
		fill(
			"landuse-industrial",
			"landuse",
			["in", ["get", "class"], ["literal", ["industrial", "commercial", "railway"]]],
			colours.industrial,
		),
		fill("water", "water", ["!=", ["get", "brunnel"], "tunnel"], colours.water),
		line("waterway", "waterway", ["!=", ["get", "brunnel"], "tunnel"], colours.waterway, [
			[8, 0.4],
			[16, 3],
		]),
		line(
			"road-path",
			"transportation",
			["==", ["get", "class"], "path"],
			colours.path,
			[
				[13, 0.5],
				[18, 2],
			],
			[2, 1.5],
			12,
		),
		line(
			"road-service",
			"transportation",
			["in", ["get", "class"], ["literal", ["service", "track"]]],
			colours.serviceRoad,
			[
				[13, 0.5],
				[18, 5],
			],
			undefined,
			12,
		),
		line(
			"road-minor",
			"transportation",
			["==", ["get", "class"], "minor"],
			colours.minorRoad,
			[
				[11, 0.4],
				[18, 9],
			],
			undefined,
			10,
		),
		line(
			"road-major",
			"transportation",
			["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk"]]],
			colours.majorRoad,
			[
				[6, 0.4],
				[18, 14],
			],
		),
		line("road-motorway", "transportation", ["==", ["get", "class"], "motorway"], colours.motorway, [
			[5, 0.6],
			[18, 18],
		]),
		line("rail", "transportation", ["in", ["get", "class"], ["literal", ["rail", "transit"]]], colours.rail, [
			[8, 0.5],
			[18, 3],
		]),
		line(
			"aerialway",
			"transportation",
			["==", ["get", "class"], "aerialway"],
			colours.aerialway,
			[
				[11, 0.5],
				[18, 2],
			],
			[1, 2],
			11,
		),
		line(
			"ferry",
			"transportation",
			["==", ["get", "class"], "ferry"],
			colours.waterway,
			[
				[8, 0.5],
				[16, 2],
			],
			[3, 2],
		),
		{
			id: "buildings",
			type: "fill-extrusion",
			source: TILES_SOURCE,
			"source-layer": "building",
			minzoom: BUILDING_MIN_ZOOM,
			paint: {
				"fill-extrusion-color": toCss(colours.building),
				"fill-extrusion-height": ["coalesce", ["get", "render_height"], FLOOR_HEIGHT_M],
				"fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
				"fill-extrusion-opacity": 0.9,
			},
			...group("detail"),
		},
	];
}

function orientationLayers(colours: MapColours): LayerSpecification[] {
	return [
		{
			id: "border",
			type: "line",
			source: TILES_SOURCE,
			"source-layer": "boundary",
			filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
			paint: {
				"line-color": toCss(colours.border),
				"line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 12, 2.5],
			},
			...group("orientation"),
		},
	];
}

function labelLayers(colours: MapColours): LayerSpecification[] {
	const text = {
		"text-color": toCss(colours.label),
		"text-halo-color": toCss(colours.labelHalo),
		"text-halo-width": 1.4,
	};
	return [
		{
			id: FIRST_LABEL_LAYER,
			type: "symbol",
			source: TILES_SOURCE,
			"source-layer": "transportation_name",
			minzoom: 13,
			layout: { "symbol-placement": "line", "text-field": NAME, "text-font": REGULAR_FONT, "text-size": 12 },
			paint: text,
			...group("detail"),
		},
		{
			id: "label-water",
			type: "symbol",
			source: TILES_SOURCE,
			"source-layer": "water_name",
			layout: { "text-field": NAME, "text-font": ITALIC_FONT, "text-size": 13 },
			paint: { ...text, "text-color": toCss(colours.waterway) },
			...group("detail"),
		},
		{
			id: "label-peak",
			type: "symbol",
			source: TILES_SOURCE,
			"source-layer": "mountain_peak",
			minzoom: 11,
			filter: ["has", "name"],
			layout: {
				"text-field": ["concat", NAME, "\n", ["to-string", ["get", "ele"]], " m"],
				"text-font": ITALIC_FONT,
				"text-size": 11,
			},
			paint: text,
			...group("detail"),
		},
		{
			id: "label-place",
			type: "symbol",
			source: TILES_SOURCE,
			"source-layer": "place",
			filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb", "hamlet"]]],
			layout: {
				"text-field": NAME,
				"text-font": BOLD_FONT,
				"text-size": ["match", ["get", "class"], "city", 16, "town", 14, 12],
			},
			paint: text,
			...group("detail"),
		},
	];
}

function fill(id: string, sourceLayer: string, filter: ExpressionSpecification, colour: Rgba): LayerSpecification {
	return {
		id,
		type: "fill",
		source: TILES_SOURCE,
		"source-layer": sourceLayer,
		filter,
		paint: { "fill-color": toCss(colour) },
		...group("detail"),
	};
}

/** A line layer whose width grows with zoom through `widths` ([zoom, pixels] stops). */
function line(
	id: string,
	sourceLayer: string,
	filter: ExpressionSpecification,
	colour: Rgba,
	widths: readonly (readonly [number, number])[],
	dashes?: readonly [number, number],
	minZoom = 0,
): LayerSpecification {
	return {
		id,
		type: "line",
		source: TILES_SOURCE,
		"source-layer": sourceLayer,
		filter,
		minzoom: minZoom,
		layout: { "line-cap": "round", "line-join": "round" },
		paint: {
			"line-color": toCss(colour),
			"line-width": ["interpolate", ["exponential", 1.6], ["zoom"], ...widths.flat()] as ExpressionSpecification,
			...(dashes === undefined ? {} : { "line-dasharray": [...dashes] }),
		},
		...group("detail"),
	};
}

function group(layerGroup: LayerGroup): { metadata: Record<string, LayerGroup> } {
	return { metadata: { [LAYER_GROUP_KEY]: layerGroup } };
}
