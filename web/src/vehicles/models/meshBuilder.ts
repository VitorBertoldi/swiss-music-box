/**
 * Builds low-poly vehicle meshes in code: boxes and extruded convex outlines, flat-shaded, with
 * a colour per face. The model's frame is in metres: x forward, y to the left, z up, with the
 * origin at the middle of its underside (on the rails, at the waterline, at the cabin floor).
 */

/** A colour with channels 0..1 (white in a tinted part takes the vehicle's palette colour). */
export type Rgb = readonly [red: number, green: number, blue: number];
export type Vec3 = readonly [x: number, y: number, z: number];
/** A point of an outline, in the plane named by the method that takes it. */
export type Point2 = readonly [number, number];

/** Vertex arrays as deck.gl's SimpleMeshLayer reads them; three vertices per triangle. */
export interface MeshData {
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly colors: Float32Array;
	readonly vertexCount: number;
}

/** The size of a mesh, measured from its vertices. */
export interface Extent {
	readonly min: Vec3;
	readonly max: Vec3;
}

/**
 * Every shape added is convex, so each face's normal is simply turned away from the shape's
 * centre: lighting is right however a face's corners happen to be listed.
 */
export class MeshBuilder {
	private readonly positions: number[] = [];
	private readonly normals: number[] = [];
	private readonly colors: number[] = [];

	/** A box between two opposite corners. */
	box(from: Vec3, to: Vec3, colour: Rgb): this {
		const [x0, x1] = ordered(from[0], to[0]);
		const [y0, y1] = ordered(from[1], to[1]);
		const [z0, z1] = ordered(from[2], to[2]);
		const bottom: Vec3[] = [
			[x0, y0, z0],
			[x1, y0, z0],
			[x1, y1, z0],
			[x0, y1, z0],
		];
		return this.prism(bottom, [0, 0, z1 - z0], colour);
	}

	/** A side profile (convex, in x-z) extruded across the vehicle from `rightY` to `leftY`: noses, sloped ends. */
	sideProfile(profile: readonly Point2[], rightY: number, leftY: number, colour: Rgb): this {
		return this.prism(
			profile.map(([x, z]): Vec3 => [x, rightY, z]),
			[0, leftY - rightY, 0],
			colour,
		);
	}

	/** A top-view outline (convex, in x-y) extruded from `bottomZ` to `topZ`: hulls, decks. */
	plan(outline: readonly Point2[], bottomZ: number, topZ: number, colour: Rgb): this {
		return this.prism(
			outline.map(([x, y]): Vec3 => [x, y, bottomZ]),
			[0, 0, topZ - bottomZ],
			colour,
		);
	}

	build(): MeshData {
		return {
			positions: Float32Array.from(this.positions),
			normals: Float32Array.from(this.normals),
			colors: Float32Array.from(this.colors),
			vertexCount: this.positions.length / 3,
		};
	}

	/** A convex polygon `ring` swept by `offset`: two caps and a wall per edge. */
	private prism(ring: readonly Vec3[], offset: Vec3, colour: Rgb): this {
		const far = ring.map((point) => add(point, offset));
		const centre = add(mean(ring), scale(offset, 0.5));
		for (let i = 1; i + 1 < ring.length; i++) {
			this.triangle(at(ring, 0), at(ring, i), at(ring, i + 1), centre, colour);
			this.triangle(at(far, 0), at(far, i), at(far, i + 1), centre, colour);
		}
		for (let i = 0; i < ring.length; i++) {
			const next = (i + 1) % ring.length;
			this.triangle(at(ring, i), at(ring, next), at(far, next), centre, colour);
			this.triangle(at(ring, i), at(far, next), at(far, i), centre, colour);
		}
		return this;
	}

	private triangle(a: Vec3, b: Vec3, c: Vec3, centre: Vec3, colour: Rgb): void {
		let normal = faceNormal(a, b, c);
		const outwards = subtract(mean([a, b, c]), centre);
		if (dot(normal, outwards) < 0) normal = scale(normal, -1);
		for (const vertex of [a, b, c]) {
			this.positions.push(...vertex);
			this.normals.push(...normal);
			this.colors.push(...colour);
		}
	}
}

/** Number of triangles a box adds. */
export const TRIANGLES_PER_BOX = 12;

/** The smallest box holding every vertex. */
export function extentOf(mesh: MeshData): Extent {
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	mesh.positions.forEach((value, i) => {
		const axis = i % 3;
		min[axis] = Math.min(min[axis] ?? value, value);
		max[axis] = Math.max(max[axis] ?? value, value);
	});
	return { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] };
}

function ordered(a: number, b: number): [number, number] {
	return a <= b ? [a, b] : [b, a];
}

function at(points: readonly Vec3[], index: number): Vec3 {
	const point = points[index];
	if (point === undefined) throw new RangeError(`no point ${index}`);
	return point;
}

function add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, factor: number): Vec3 {
	return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function mean(points: readonly Vec3[]): Vec3 {
	const sum = points.reduce((total, point) => add(total, point), [0, 0, 0] as Vec3);
	return scale(sum, 1 / points.length);
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
	const u = subtract(b, a);
	const v = subtract(c, a);
	const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
	const length = Math.hypot(...cross) || 1;
	return scale(cross, 1 / length);
}
