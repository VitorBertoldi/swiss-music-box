import type { Layer } from "@deck.gl/core";
import { LineLayer } from "@deck.gl/layers";
import type { LonLat } from "../render/lonLat";
import type { FrameState, Scene } from "./scene";

/** A tenth of a degree: about 11 km north-south, 7.5 km east-west over Switzerland. */
const GRID_STEP_DEGREES = 0.1;
const GRID_WEST = 5.5;
const GRID_EAST = 11;
const GRID_SOUTH = 45.5;
const GRID_NORTH = 48;
const MAJOR_EVERY = 5;

interface GridLine {
	readonly from: LonLat;
	readonly to: LonLat;
	readonly isMajor: boolean;
}

/**
 * Scene 3: for setting up the projector in the room. A 0.1° grid (every 0.5° brighter)
 * shows geometry and focus; the overlay shows colour and grey ramps, the resolution the
 * browser renders at, and the frame rate.
 */
export class CalibrationScene implements Scene {
	readonly id = "calibration";
	readonly title = "Calibration";
	readonly mapMode = "none";
	private readonly grid = gridLines();

	constructor(
		private readonly overlay: HTMLElement,
		private readonly readout: HTMLElement,
	) {}

	show(): void {
		this.overlay.hidden = false;
	}

	hide(): void {
		this.overlay.hidden = true;
	}

	layers(frame: FrameState, opacity: number): Layer[] {
		this.readout.textContent = [
			`${window.innerWidth * devicePixelRatio} × ${window.innerHeight * devicePixelRatio} px`,
			`device pixel ratio ${devicePixelRatio}`,
			`${frame.framesPerSecond.toFixed(0)} fps`,
			`palette: ${frame.palette.name}`,
		].join(" · ");
		return [
			new LineLayer<GridLine>({
				id: `${this.id}-grid`,
				data: this.grid,
				getSourcePosition: (line) => line.from,
				getTargetPosition: (line) => line.to,
				getColor: (line) => (line.isMajor ? [255, 255, 255, 160] : [255, 255, 255, 50]),
				getWidth: (line) => (line.isMajor ? 1.5 : 1),
				widthUnits: "pixels",
				opacity,
			}),
		];
	}
}

function gridLines(): GridLine[] {
	const steps = (from: number, to: number): number[] =>
		Array.from({ length: Math.round((to - from) / GRID_STEP_DEGREES) + 1 }, (_, i) => from + i * GRID_STEP_DEGREES);
	const meridians = steps(GRID_WEST, GRID_EAST).map(
		(longitude, i): GridLine => ({
			from: [longitude, GRID_SOUTH],
			to: [longitude, GRID_NORTH],
			isMajor: i % MAJOR_EVERY === 0,
		}),
	);
	const parallels = steps(GRID_SOUTH, GRID_NORTH).map(
		(latitude, i): GridLine => ({
			from: [GRID_WEST, latitude],
			to: [GRID_EAST, latitude],
			isMajor: i % MAJOR_EVERY === 0,
		}),
	);
	return [...meridians, ...parallels];
}
