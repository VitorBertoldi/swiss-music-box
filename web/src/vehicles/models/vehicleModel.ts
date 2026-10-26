import type { Layer } from "@deck.gl/core";
import { ScenegraphLayer, SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { GLTFLoader } from "@loaders.gl/gltf";
import type { MeshAttributes } from "@loaders.gl/schema";
import type { OverlayProps } from "../../map/overlayProps";
import type { Rgba } from "../../render/palette";
import type { Pose3D } from "../motion";
import { type Shape, widening } from "../shape";
import { minimumWidthM, SOLID_MATERIAL, solidLayer, type VehicleFrame } from "../vehicleKind";
import type { ModelParts } from "./catalogue";
import type { MeshData } from "./meshBuilder";

/**
 * How one part of a vehicle is drawn: a strategy, so a kind can swap representations with the
 * zoom (a box from afar, a detailed mesh up close) or for a Blender model, without changing.
 */
export interface VehicleModel {
	/** Length of the part, which decides whether it is worth drawing in detail. */
	readonly lengthM: number;
	/** Layers for every pose, coloured `tint` where the model takes the vehicle's colour. */
	layers(id: string, poses: readonly Pose3D[], tint: Rgba, frame: VehicleFrame): Layer[];
}

const WHITE: Rgba = [255, 255, 255, 255];

/**
 * deck.gl's [pitch, yaw, roll] for a pose: its yaw turns counter-clockwise from east and its
 * pitch tips the nose down, where a pose's yaw is a compass heading and its pitch lifts the nose.
 */
export function deckOrientation(pose: Pose3D): [pitch: number, yaw: number, roll: number] {
	return [-pose.pitchDeg, 90 - pose.yawDeg, pose.rollDeg];
}

/** A model built in code (`catalogue.ts`): one instanced mesh layer per part. */
export class MeshModel implements VehicleModel {
	readonly lengthM: number;
	private readonly tinted: { attributes: MeshAttributes };
	private readonly fixed: { attributes: MeshAttributes };

	constructor(private readonly parts: ModelParts) {
		this.lengthM = parts.lengthM;
		// Built once: deck.gl uploads a mesh to the GPU only when its object changes.
		this.tinted = meshAttributes(parts.tinted);
		this.fixed = meshAttributes(parts.fixed);
	}

	layers(id: string, poses: readonly Pose3D[], tint: Rgba, frame: VehicleFrame): Layer[] {
		const { lengthM, widthM, heightM } = this.parts;
		// Seen from further out, a model is drawn wider and taller than it is, as boxes are.
		const [width, height] = widening(lengthM, widthM, heightM, minimumWidthM(frame)) ?? [widthM, heightM];
		const scale: [number, number, number] = [1, width / widthM, height / heightM];
		const part = (suffix: string, mesh: { attributes: MeshAttributes }, colour: Rgba): Layer =>
			new SimpleMeshLayer<Pose3D, OverlayProps>({
				id: `${id}-${suffix}`,
				data: poses,
				mesh,
				getPosition: (pose) => [...pose.position],
				getOrientation: deckOrientation,
				getScale: scale,
				getColor: [...colour],
				material: SOLID_MATERIAL,
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			});
		return [part("tinted", this.tinted, tint), part("fixed", this.fixed, WHITE)];
	}
}

/** A part drawn as an extruded footprint: cheap, for vehicles seen from further out. */
export class BoxModel implements VehicleModel {
	readonly lengthM: number;

	constructor(private readonly shape: Shape) {
		this.lengthM = shape.lengthM;
	}

	layers(id: string, poses: readonly Pose3D[], tint: Rgba, frame: VehicleFrame): Layer[] {
		const shape = this.shape.widened(minimumWidthM(frame));
		const solids = poses.map((pose) => ({ footprint: shape.footprint(pose), heightM: shape.heightM, colour: tint }));
		return [solidLayer(`${id}-boxes`, solids, frame)];
	}
}

/**
 * A model exported from Blender as glTF (metres, x forward, y left, z up, origin under its
 * middle), drawn with its own materials; `tint` is ignored.
 */
export class GltfModel implements VehicleModel {
	constructor(
		private readonly url: string,
		readonly lengthM: number,
	) {}

	layers(id: string, poses: readonly Pose3D[], _tint: Rgba, frame: VehicleFrame): Layer[] {
		return [
			new ScenegraphLayer<Pose3D, OverlayProps>({
				id: `${id}-gltf`,
				data: poses,
				scenegraph: this.url,
				loaders: [GLTFLoader],
				getPosition: (pose) => [...pose.position],
				getOrientation: deckOrientation,
				_lighting: "pbr",
				opacity: frame.opacity,
				beforeId: frame.beforeId,
			}),
		];
	}
}

/** Which model a frame should use for a part. */
export interface ModelChoice {
	readonly model: VehicleModel;
	/** Whether it's the detailed one (the far one is plainer, so it may need a hint of direction). */
	readonly isDetailed: boolean;
}

/**
 * Detailed model when the part is long enough on screen to show its detail, a plain one
 * otherwise. From about zoom 15.5 an IC coach (27 m) is 18 pixels long.
 */
export class LevelOfDetail {
	constructor(
		private readonly detailed: VehicleModel,
		private readonly plain: VehicleModel,
		private readonly minDetailedLengthPx = DETAILED_MIN_LENGTH_PX,
	) {}

	choose(frame: VehicleFrame): ModelChoice {
		const isDetailed = this.detailed.lengthM / frame.metresPerPixel >= this.minDetailedLengthPx;
		return { model: isDetailed ? this.detailed : this.plain, isDetailed };
	}
}

export const DETAILED_MIN_LENGTH_PX = 18;

function meshAttributes(mesh: MeshData): { attributes: MeshAttributes } {
	return {
		attributes: {
			positions: { value: mesh.positions, size: 3 },
			normals: { value: mesh.normals, size: 3 },
			colors: { value: mesh.colors, size: 3 },
		},
	};
}
