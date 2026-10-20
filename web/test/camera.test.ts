import { describe, expect, it } from "vitest";
import { FreeCamera, OverviewCamera, SWITZERLAND_VIEW } from "../src/camera/basicCameras";
import { toPose, zoomForSpan } from "../src/camera/camera";
import { FollowCamera } from "../src/camera/followCamera";
import { easeInOut, interpolateView, type Shot, TourCamera, TRANSITION_MINUTES } from "../src/camera/tourCamera";
import { viewFromSearch } from "../src/camera/viewParameter";
import { VehicleTimeline } from "../src/render/vehicleTimeline";
import { SceneRegistry } from "../src/scenes/registry";
import type { Scene } from "../src/scenes/scene";
import { BERN, makeMotion } from "./fixtures";

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6_378_137;
const pose = { centre: BERN, zoom: 12, pitch: 0, bearing: 0 } as const;
const wide: Shot = {
	fromMinute: 0,
	caption: "wide",
	view: { centre: [8, 46.8], spanM: 400_000, pitch: 0, bearing: 0 },
};
const close: Shot = {
	fromMinute: 600,
	caption: "close",
	view: { centre: [8.5, 47.4], spanM: 25_000, pitch: 60, bearing: 30 },
};

describe("camera geometry", () => {
	it("shows the whole world in one 512 px tile at zoom 0", () => {
		expect(zoomForSpan(EARTH_CIRCUMFERENCE_M, 0, 512)).toBeCloseTo(0);
		expect(zoomForSpan(EARTH_CIRCUMFERENCE_M / 2, 0, 512)).toBeCloseTo(1);
	});

	it("needs less zoom further north for the same ground span (Mercator)", () => {
		expect(zoomForSpan(10_000, 47, 1920)).toBeLessThan(zoomForSpan(10_000, 0, 1920));
		expect(toPose(SWITZERLAND_VIEW, 1920).zoom).toBeCloseTo(8.08, 2);
	});

	it("reads a shared view from the address", () => {
		expect(viewFromSearch("?view=8.5402,47.3779,16,60,-30")).toEqual({
			centre: [8.5402, 47.3779],
			zoom: 16,
			pitch: 60,
			bearing: -30,
		});
		expect(viewFromSearch("?view=8.54,47.37")).toBeNull();
		expect(viewFromSearch("")).toBeNull();
	});
});

describe("camera modes", () => {
	it("free leaves the camera alone; overview holds the country", () => {
		expect(new FreeCamera().viewAt()).toBeNull();
		expect(new OverviewCamera().viewAt()).toEqual(SWITZERLAND_VIEW);
	});

	it("tour holds a shot until the transition before the next one", () => {
		const tour = new TourCamera([wide, close]);
		expect(tour.viewAt({ minute: 100 })).toEqual(wide.view);
		expect(tour.captionAt(600)).toBe("close");
	});

	it("tour flies in during the transition: geometric zoom, linear tilt", () => {
		const midway = new TourCamera([wide, close]).viewAt({ minute: 600 - TRANSITION_MINUTES / 2 });
		expect(midway.spanM).toBeCloseTo(Math.sqrt(400_000 * 25_000));
		expect(midway.pitch).toBeCloseTo(30);
		expect(interpolateView(wide.view, close.view, 1)).toEqual(close.view);
		expect(easeInOut(0.5)).toBe(0.5);
	});

	it("follow rides with a moving train, close and tilted", () => {
		const follow = new FollowCamera(new VehicleTimeline(makeMotion()));
		const view = follow.viewAt({ minute: 481, current: pose }); // not yet in the tunnel
		expect(view?.spanM).toBeLessThan(5_000);
		expect(view?.pitch).toBeGreaterThan(0);
		expect(follow.captionAt()).toBe("Following an IC / IR train");
	});

	it("follow lets go when nothing it can follow is running", () => {
		const follow = new FollowCamera(new VehicleTimeline(makeMotion()), ["boat"]);
		expect(follow.viewAt({ minute: 485, current: pose })).toBeNull();
	});
});

describe("scene registry", () => {
	const scene = (id: Scene["id"]): Scene => ({ id, title: id, mapMode: "full", layers: () => [] });

	it("lists scenes in registration order for the number keys", () => {
		const registry = new SceneRegistry().register(scene("living-map")).register(scene("calibration"));
		expect(registry.list().map((registered) => registered.id)).toEqual(["living-map", "calibration"]);
	});

	it("refuses the same scene twice", () => {
		expect(() => new SceneRegistry().register(scene("living-map")).register(scene("living-map"))).toThrow();
	});
});
