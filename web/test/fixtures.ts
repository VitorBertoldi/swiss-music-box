import type { Day } from "../src/contract/day";
import type { Motion } from "../src/contract/motion";
import { MINUTES_PER_DAY } from "../src/music/constants";
import type { NoteLayer } from "../src/music/types";

type NoteRow = readonly [minute: number, station: number, layer: NoteLayer, tripStart: boolean];

/** A tiny day: three stations west -> east and low -> high, and one tunnel. */
export function makeDay(noteRows: readonly NoteRow[]): Day {
	const sorted = [...noteRows].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const occupancy = new Array<number>(MINUTES_PER_DAY).fill(0);
	occupancy.fill(2, 600, 620);
	const busCounts = Array.from({ length: MINUTES_PER_DAY }, (_, minute) => (minute === 480 ? [10, 0, 5] : [0, 0, 0]));
	return {
		schema_version: 3,
		service_date: "2026-10-21",
		source: "test",
		minutes_per_day: 1440,
		texture_bins: 3,
		bounds: {
			min_easting_m: 2_480_000,
			max_easting_m: 2_840_000,
			min_northing_m: 1_070_000,
			max_northing_m: 1_300_000,
		},
		stations: [
			{
				name: "Genève",
				easting_m: 2_500_000,
				northing_m: 1_118_000,
				longitude: 6.1424,
				latitude: 46.2102,
				elevation_m: 375,
			},
			{
				name: "Bern",
				easting_m: 2_600_000,
				northing_m: 1_200_000,
				longitude: 7.4386,
				latitude: 46.9511,
				elevation_m: 540,
			},
			{
				name: "Jungfraujoch",
				easting_m: 2_641_000,
				northing_m: 1_155_000,
				longitude: 7.9852,
				latitude: 46.5475,
				elevation_m: 3454,
			},
		],
		notes: {
			minute: sorted.map((row) => row[0]),
			station: sorted.map((row) => row[1]),
			layer: sorted.map((row) => row[2]),
			trip_start: sorted.map((row) => row[3]),
		},
		textures: [{ layer: "bus", counts: busCounts }],
		tunnels: [
			{
				id: "gotthard-basistunnel",
				name: "Gotthard-Basistunnel",
				easting_m: 2_700_000,
				northing_m: 1_150_000,
				occupancy,
			},
		],
	};
}

/** Bern, and how many degrees of longitude make 5 km there (for exact test geometry). */
export const BERN: readonly [number, number] = [7.43864, 46.95108];
export const LONGITUDE_PER_5_KM = 5000 / ((6_371_008.8 * Math.cos((BERN[1] * Math.PI) / 180) * Math.PI) / 180);

/**
 * One straight 10 km segment running east from Bern, its middle 20-60 % in a tunnel, and
 * two trips: an IC runs it eastwards 08:00-08:10 then back 08:15-08:25; an S-Bahn starts at
 * 23:55 and arrives after midnight.
 */
export function makeMotion(): Motion {
	const [longitude, latitude] = BERN;
	const coordinates = [
		longitude,
		latitude,
		longitude + LONGITUDE_PER_5_KM,
		latitude,
		longitude + 2 * LONGITUDE_PER_5_KM,
		latitude,
	];
	return {
		schema_version: 3,
		service_date: "2026-10-21",
		segments: [
			{
				coordinates,
				overview_coordinates: coordinates,
				length_m: 10_000,
				route: "track",
				tunnels: [{ tunnel: 0, start_fraction: 0.2, end_fraction: 0.6 }],
			},
		],
		trips: { layer: ["long_rail", "regional_rail"], first_leg: [0, 2], leg_count: [2, 1] },
		legs: {
			segment: [0, 0, 0],
			reversed: [false, true, false],
			depart_minute: [480, 495, 1435],
			arrive_minute: [490, 505, 1445],
		},
		tunnels: [
			{
				id: "test-tunnel",
				name: "Test tunnel",
				length_m: 4_000,
				coordinates: [longitude + 0.4 * LONGITUDE_PER_5_KM, latitude, longitude + 1.2 * LONGITUDE_PER_5_KM, latitude],
			},
		],
	};
}
