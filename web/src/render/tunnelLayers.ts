import type { Layer } from "@deck.gl/core";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { TunnelSeries } from "../contract/day";
import type { Tunnel } from "../contract/motion";
import type { OverlayProps } from "../map/overlayProps";
import { at } from "../music/collections";
import { distanceM, type LonLat, toLonLats } from "./lonLat";
import type { Palette } from "./palette";

const BASE_GLOW_WIDTH_PX = 2;
const MAX_EXTRA_GLOW_WIDTH_PX = 5;
const TRAINS_FOR_FULL_GLOW = 3;
const LABEL_SIZE_PX = 13;
const LABEL_OFFSET_PX: [number, number] = [0, -16];
/** Labels closer than this would overlap at national scale; the longer tunnel keeps its label. */
const MIN_LABEL_SEPARATION_M = 25_000;

interface LitTunnel {
	readonly name: string;
	readonly lengthM: number;
	readonly axis: readonly LonLat[];
	readonly occupancy: readonly number[];
}

/** Tunnels that glow, and name themselves, while trains are inside. */
export class TunnelGlow {
	private readonly tunnels: readonly LitTunnel[];

	/** Only drone tunnels glow: the ones the music also hears. */
	constructor(axes: readonly Tunnel[], drones: readonly TunnelSeries[]) {
		const axisById = new Map(axes.map((tunnel) => [tunnel.id, tunnel]));
		this.tunnels = drones.flatMap((drone) => {
			const axis = axisById.get(drone.id);
			if (axis === undefined) return [];
			return [
				{ name: drone.name, lengthM: axis.length_m, axis: toLonLats(axis.coordinates), occupancy: drone.occupancy },
			];
		});
	}

	/** The glow goes below the map labels (`beneathLabels`); tunnel names stay on top. */
	layers(
		minute: number,
		palette: Palette,
		opacity: number,
		showLabels: boolean,
		idPrefix: string,
		beneathLabels: string,
	): Layer[] {
		const wholeMinute = Math.floor(minute);
		const lit = this.tunnels.filter((tunnel) => at(tunnel.occupancy, wholeMinute) > 0);
		const glow = (tunnel: LitTunnel): number => Math.min(1, at(tunnel.occupancy, wholeMinute) / TRAINS_FOR_FULL_GLOW);
		const [red, green, blue] = palette.tunnelGlow;
		const layers: Layer[] = [
			new PathLayer<LitTunnel, OverlayProps>({
				id: `${idPrefix}-tunnel-glow`,
				data: lit,
				getPath: (tunnel) => tunnel.axis as LonLat[],
				getWidth: (tunnel) => BASE_GLOW_WIDTH_PX + MAX_EXTRA_GLOW_WIDTH_PX * glow(tunnel),
				widthUnits: "pixels",
				getColor: (tunnel) => [red, green, blue, Math.round(90 + 140 * glow(tunnel))],
				capRounded: true,
				opacity,
				updateTriggers: { getWidth: wholeMinute, getColor: wholeMinute },
				beforeId: beneathLabels,
			}),
		];
		if (showLabels) {
			layers.push(
				new TextLayer<LitTunnel>({
					id: `${idPrefix}-tunnel-labels`,
					data: labelled(lit),
					getPosition: (tunnel) => midpoint(tunnel.axis),
					getText: (tunnel) => tunnel.name,
					getSize: LABEL_SIZE_PX,
					getColor: [...palette.label],
					getPixelOffset: LABEL_OFFSET_PX,
					fontFamily: "Inter, system-ui, sans-serif",
					characterSet: "auto",
					opacity,
				}),
			);
		}
		return layers;
	}
}

/** Longest tunnels first; a label too close to one already placed is left out. */
export function labelled<T extends { readonly lengthM: number; readonly axis: readonly LonLat[] }>(
	tunnels: readonly T[],
): T[] {
	const placed: T[] = [];
	for (const tunnel of [...tunnels].sort((a, b) => b.lengthM - a.lengthM)) {
		const centre = midpoint(tunnel.axis);
		const isClear = placed.every((other) => distanceM(centre, midpoint(other.axis)) >= MIN_LABEL_SEPARATION_M);
		if (isClear) placed.push(tunnel);
	}
	return placed;
}

function midpoint(axis: readonly LonLat[]): LonLat {
	const [startLongitude, startLatitude] = at(axis, 0);
	const [endLongitude, endLatitude] = at(axis, axis.length - 1);
	return [(startLongitude + endLongitude) / 2, (startLatitude + endLatitude) / 2];
}
