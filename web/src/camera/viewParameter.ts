import type { CameraPose } from "../map/mapView";

/**
 * A camera pose from the page address, e.g. `?view=8.5402,47.3779,16,60,-30`
 * (longitude, latitude, zoom, pitch, bearing). Handy to share a street-level view with the group.
 */
export function viewFromSearch(search: string): CameraPose | null {
	const value = new URLSearchParams(search).get("view");
	if (value === null) return null;
	const numbers = value.split(",").map(Number);
	if (numbers.length < 3 || numbers.some((number) => !Number.isFinite(number))) return null;
	const [longitude = 0, latitude = 0, zoom = 0, pitch = 0, bearing = 0] = numbers;
	return { centre: [longitude, latitude], zoom, pitch, bearing };
}
