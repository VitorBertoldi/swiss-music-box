import { type LonLat, offsetLonLat } from "../render/lonLat";
import type { Placement } from "./motion";

/** A corner of a footprint: longitude, latitude and height above the map in metres. */
export type Corner = [longitude: number, latitude: number, heightM: number];

/** What one part of a vehicle looks like: a footprint raised into a solid. */
export interface Shape {
	readonly heightM: number;
	/** The outline of the part's underside, placed and turned as the placement says. */
	footprint(placement: Placement): Corner[];
}

/** Corners given in the part's own frame (metres ahead of and to the right of its centre). */
type LocalOutline = readonly (readonly [aheadM: number, rightM: number])[];

function placeOutline(outline: LocalOutline, placement: Placement): Corner[] {
	const heading = (placement.headingDeg * Math.PI) / 180;
	// Unit vectors (east, north) pointing ahead and to the right of the part.
	const ahead = [Math.sin(heading), Math.cos(heading)] as const;
	const right = [Math.cos(heading), -Math.sin(heading)] as const;
	return outline.map(([aheadM, rightM]): Corner => {
		const point: LonLat = offsetLonLat(
			placement.centre,
			aheadM * ahead[0] + rightM * right[0],
			aheadM * ahead[1] + rightM * right[1],
		);
		return [point[0], point[1], placement.baseM];
	});
}

/** A rectangular solid: a train car, a funicular, a cable-car cabin. */
export class Box implements Shape {
	private readonly outline: LocalOutline;

	constructor(
		readonly lengthM: number,
		readonly widthM: number,
		readonly heightM: number,
	) {
		const halfLength = lengthM / 2;
		const halfWidth = widthM / 2;
		this.outline = [
			[halfLength, halfWidth],
			[halfLength, -halfWidth],
			[-halfLength, -halfWidth],
			[-halfLength, halfWidth],
		];
	}

	footprint(placement: Placement): Corner[] {
		return placeOutline(this.outline, placement);
	}
}

/** Share of a hull's length taken by the tapering bow. */
const BOW_SHARE = 0.25;

/** A boat's hull: square stern, pointed bow. */
export class Hull implements Shape {
	private readonly outline: LocalOutline;

	constructor(
		readonly lengthM: number,
		readonly widthM: number,
		readonly heightM: number,
	) {
		const halfLength = lengthM / 2;
		const halfWidth = widthM / 2;
		const bowStart = halfLength - lengthM * BOW_SHARE;
		this.outline = [
			[halfLength, 0],
			[bowStart, -halfWidth],
			[-halfLength, -halfWidth],
			[-halfLength, halfWidth],
			[bowStart, halfWidth],
		];
	}

	footprint(placement: Placement): Corner[] {
		return placeOutline(this.outline, placement);
	}
}
