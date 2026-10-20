import type { Layer } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
// MapLibre 5 is the major version deck.gl's interleaved overlay supports (6 changed internals it reads).
import { AttributionControl, addProtocol, Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import type { LonLat } from "../render/lonLat";
import { AssetBundleLoader, BUNDLE_PROTOCOL, parseBundleUrl } from "./assetBundles";
import { LAYER_GROUP_KEY, type LayerGroup } from "./style";

/** Where the camera is: what MapLibre calls the camera options, in our own terms. */
export interface CameraPose {
	readonly centre: LonLat;
	readonly zoom: number;
	readonly pitch: number;
	readonly bearing: number;
}

/** Which groups of map layers are visible. */
export type MapMode = "full" | "outline" | "none";

const VISIBLE_GROUPS: Readonly<Record<MapMode, ReadonlySet<LayerGroup>>> = {
	full: new Set(["ground", "detail", "orientation"]),
	outline: new Set(["ground", "orientation"]),
	none: new Set(["ground"]),
};
/** Street-level views stay sharp past the deepest tiles by overzooming them. */
const MAX_ZOOM = 19;
const MAX_PITCH = 70;

let areProtocolsRegistered = false;

/**
 * Adapter around MapLibre GL: the only module that talks to it. Draws the vector-tile map
 * and, interleaved with it, the deck.gl layers (so trains pass under 3D buildings).
 */
export class MapView {
	private readonly overlay: MapboxOverlay;
	private mode: MapMode = "full";

	private constructor(private readonly map: MapLibreMap) {
		this.overlay = new MapboxOverlay({ interleaved: true, layers: [] });
		map.addControl(this.overlay);
		map.addControl(new AttributionControl({ compact: true }), "bottom-right");
	}

	/** Resolves once the style has loaded; rejects if the map reports an error first. */
	static async create(container: HTMLElement, style: StyleSpecification, pose: CameraPose): Promise<MapView> {
		if (!areProtocolsRegistered) {
			registerProtocols();
			areProtocolsRegistered = true;
		}
		const map = new MapLibreMap({
			container,
			style,
			center: [pose.centre[0], pose.centre[1]],
			zoom: pose.zoom,
			pitch: pose.pitch,
			bearing: pose.bearing,
			maxZoom: MAX_ZOOM,
			maxPitch: MAX_PITCH,
			attributionControl: false,
		});
		await new Promise<void>((resolve, reject) => {
			map.once("load", () => resolve());
			map.once("error", (event) => reject(event.error));
		});
		return new MapView(map);
	}

	setStyle(style: StyleSpecification): void {
		this.map.setStyle(style);
		this.map.once("styledata", () => this.applyMode());
	}

	showMode(mode: MapMode): void {
		if (mode === this.mode) return;
		this.mode = mode;
		this.applyMode();
	}

	setDeckLayers(layers: Layer[]): void {
		this.overlay.setProps({ layers });
	}

	moveTo(pose: CameraPose): void {
		this.map.jumpTo({
			center: [pose.centre[0], pose.centre[1]],
			zoom: pose.zoom,
			pitch: pose.pitch,
			bearing: pose.bearing,
		});
	}

	pose(): CameraPose {
		const centre = this.map.getCenter();
		return {
			centre: [centre.lng, centre.lat],
			zoom: this.map.getZoom(),
			pitch: this.map.getPitch(),
			bearing: this.map.getBearing(),
		};
	}

	widthPx(): number {
		return this.map.getContainer().clientWidth;
	}

	/** Called whenever a person drags, zooms, tilts or rotates the map. */
	onUserMove(listener: () => void): void {
		// Camera moves made by code have no originalEvent; only a person's input has one.
		const fromPerson = (event: { originalEvent?: unknown }): void => {
			if (event.originalEvent !== undefined) listener();
		};
		this.map.on("dragstart", fromPerson);
		this.map.on("wheel", fromPerson);
		this.map.on("pitchstart", fromPerson);
		this.map.on("rotatestart", fromPerson);
		this.map.on("touchstart", fromPerson);
	}

	resize(): void {
		this.map.resize();
	}

	private applyMode(): void {
		const visible = VISIBLE_GROUPS[this.mode];
		for (const layer of this.map.getStyle().layers) {
			const layerGroup = (layer.metadata as Record<string, LayerGroup> | undefined)?.[LAYER_GROUP_KEY];
			if (layerGroup === undefined) continue;
			this.map.setLayoutProperty(layer.id, "visibility", visible.has(layerGroup) ? "visible" : "none");
		}
	}
}

/** `pmtiles://` reads tiles from one file by range requests; `bundle://` from JSON bundles. */
function registerProtocols(): void {
	addProtocol("pmtiles", new Protocol().tile);
	const bundles = new AssetBundleLoader();
	addProtocol(BUNDLE_PROTOCOL, async (request) => {
		const data = await bundles.entry(parseBundleUrl(request.url));
		// No entry means nothing there (an all-sea tile): an empty tile, not an error.
		return { data: data ?? new ArrayBuffer(0) };
	});
}
