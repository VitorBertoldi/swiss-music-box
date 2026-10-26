/** Composition root: loads the data, builds every part and wires them together. */
import "./style.css";
import { FreeCamera, OverviewCamera, SWITZERLAND_VIEW } from "./camera/basicCameras";
import { type CameraMode, type CameraModeId, toPose } from "./camera/camera";
import { FollowCamera } from "./camera/followCamera";
import { TourCamera } from "./camera/tourCamera";
import { viewFromSearch } from "./camera/viewParameter";
import { loadShowData } from "./data/showData";
import { MapView } from "./map/mapView";
import { buildStyle, FIRST_LABEL_LAYER } from "./map/style";
import { DEFAULT_NOTES_PER_SECOND } from "./music/constants";
import { chordAt } from "./music/harmony";
import { buildScore } from "./music/score";
import type { Score } from "./music/types";
import { scoreToMidi } from "./outputs/midiFile";
import type { ScoreSink } from "./outputs/sink";
import { ToneOutput } from "./outputs/toneOutput";
import { midiOutputs, WebMidiOutput } from "./outputs/webMidiOutput";
import { Player } from "./player";
import { StationFlashes } from "./render/flashes";
import { packTracks, trackColours } from "./render/packedPaths";
import { type Palette, PROJECTOR_PALETTE, SCREEN_PALETTE } from "./render/palette";
import { TunnelGlow } from "./render/tunnelLayers";
import type { VehicleBuffers } from "./render/vehicleLayers";
import { VehicleTrackBuilder } from "./render/vehicles";
import { VehicleTimeline } from "./render/vehicleTimeline";
import { CalibrationScene } from "./scenes/calibration";
import { LivingMapScene } from "./scenes/livingMap";
import { LongExposureScene } from "./scenes/longExposure";
import { SceneRegistry } from "./scenes/registry";
import type { SceneAssets, SceneId } from "./scenes/scene";
import { Stage } from "./stage";
import { element } from "./ui/dom";
import { bindKeyboard } from "./ui/keyboard";
import { DEFAULT_SETTINGS, type Settings, SettingsControls } from "./ui/settings";
import { TransportControls } from "./ui/transport";
import { CAMERA_CHOICES, ViewControls } from "./ui/view";
import { VoiceToggles } from "./ui/voices";
import { standardVehicleKinds, VehicleKindRegistry } from "./vehicles/registry";

const DATA_URL = "data";
const SERVICE_DATE = "2026-10-21";
const SECONDS_PER_MINUTE = 60;

async function main(): Promise<void> {
	const show = await loadShowData(DATA_URL, SERVICE_DATE);

	// Sound
	let settings = DEFAULT_SETTINGS;
	const compose = (current: Settings): Score =>
		buildScore(show.day, {
			durationS: current.durationS,
			notesPerSecond: DEFAULT_NOTES_PER_SECOND,
			pitchMapping: current.pitchMapping,
		});
	let score = compose(settings);
	const player = new Player(score, settings.durationS);
	const browserSynth = new ToneOutput();
	const midiPorts = await midiOutputs().catch(() => []);
	let outputsConnected = false;
	const connectOutputs = async (): Promise<void> => {
		await player.setSinks(sinksFor(settings, browserSynth, midiPorts));
		outputsConnected = true;
	};

	// Map and visuals
	let palette: Palette = SCREEN_PALETTE;
	const styleFor = (current: Palette) => buildStyle({ colours: current.map, ...show });
	const container = element("stage", HTMLElement);
	const sharedView = viewFromSearch(location.search);
	const startPose = sharedView ?? toPose(SWITZERLAND_VIEW, container.clientWidth);
	const map = await MapView.create(container, styleFor(palette), startPose);
	// Locally the map stands on the 3D terrain; the shared link has none and stays flat.
	map.showTerrain(map.hasTerrain);
	const timeline = new VehicleTimeline(show.motion);
	const overviewTracks = new VehicleTrackBuilder(show.motion).build();
	const packedDay = packTracks(overviewTracks.all);
	const packedPastMidnight = packTracks(overviewTracks.pastMidnight);
	const colourOverviewVehicles = (current: Palette): VehicleBuffers => ({
		day: packedDay,
		dayColours: trackColours(packedDay, current),
		pastMidnight: packedPastMidnight,
		pastMidnightColours: trackColours(packedPastMidnight, current),
	});
	let overviewVehicles = colourOverviewVehicles(palette);
	const flashes = new StationFlashes(show.day.stations);
	player.onNote((note, atMs) => flashes.add(note, atMs));
	const assets: SceneAssets = {
		timeline,
		vehicleKinds: new VehicleKindRegistry(standardVehicleKinds()),
		overviewVehicles: () => overviewVehicles,
		flashes,
		tunnels: new TunnelGlow(show.motion.tunnels, show.day.tunnels),
		beneathLabels: FIRST_LABEL_LAYER,
	};
	const scenes = new SceneRegistry()
		.register(new LivingMapScene(assets))
		.register(new LongExposureScene(assets))
		.register(new CalibrationScene(element("calibration", HTMLElement), element("calibration-readout", HTMLElement)));
	const followCamera = new FollowCamera(timeline);
	const cameras: Readonly<Record<CameraModeId, CameraMode>> = {
		free: new FreeCamera(),
		overview: new OverviewCamera(),
		tour: new TourCamera(),
		follow: followCamera,
	};
	const stage = new Stage(map, scenes, "living-map", sharedView === null ? cameras.overview : cameras.free, palette);
	map.onUserMove(() => stage.useCamera(cameras.free));

	// Commands, shared by buttons and keys
	const togglePlay = (): void =>
		guard(async () => {
			if (!outputsConnected) await connectOutputs();
			if (player.playing) player.pause();
			else player.play();
		});
	const seek = (minute: number): void => {
		flashes.clear();
		player.seek(minute);
	};
	const showScene = (id: SceneId): void => stage.showScene(id);
	const useCamera = (id: CameraModeId): void => {
		if (id === "follow") followCamera.reset();
		stage.useCamera(cameras[id]);
	};
	const toggleProjectorMode = (): void => {
		palette = palette === PROJECTOR_PALETTE ? SCREEN_PALETTE : PROJECTOR_PALETTE;
		overviewVehicles = colourOverviewVehicles(palette);
		stage.usePalette(palette);
		map.setStyle(styleFor(palette));
		document.body.classList.toggle("projector", palette === PROJECTOR_PALETTE);
		requestAnimationFrame(() => map.resize());
	};
	const toggleTerrain = (): void => map.showTerrain(!map.terrainShown);
	const togglePanel = (): void => {
		document.body.classList.toggle("hide-panel");
	};
	const toggleFullscreen = (): void => {
		if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
		else document.documentElement.requestFullscreen().catch(() => undefined);
	};

	// Controls
	const transport = new TransportControls(togglePlay, seek);
	new SettingsControls(
		midiPorts,
		(next) =>
			guard(async () => {
				if (next.durationS !== settings.durationS || next.pitchMapping !== settings.pitchMapping) {
					score = compose(next);
					player.setScore(score, next.durationS);
				}
				settings = next;
				if (outputsConnected) await connectOutputs();
			}),
		() => {
			const bytes = scoreToMidi(score, { durationS: settings.durationS, layout: settings.channelLayout });
			download(bytes, `swiss-music-box-${SERVICE_DATE}-${settings.durationS / SECONDS_PER_MINUTE}min.mid`);
		},
	);
	new VoiceToggles(palette, (voice, isMuted) => player.setMuted(voice, isMuted));
	const view = new ViewControls(scenes.list(), { showScene, useCamera, toggleProjectorMode });
	bindKeyboard(
		new Map<string, () => void>([
			[" ", togglePlay],
			...scenes.list().map((scene, index): [string, () => void] => [String(index + 1), () => showScene(scene.id)]),
			...CAMERA_CHOICES.map((choice): [string, () => void] => [choice.key, () => useCamera(choice.id)]),
			["p", toggleProjectorMode],
			["e", toggleTerrain],
			["h", togglePanel],
			["f", toggleFullscreen],
		]),
	);

	const frame = (): void => {
		const nowMs = performance.now();
		const minute = player.minute;
		const caption = stage.render(minute, nowMs);
		transport.update({
			minute,
			isPlaying: player.playing,
			chord: chordAt(minute).name,
			notesPerSecond: player.notesPerSecond(),
			caption,
		});
		view.update({
			sceneId: stage.sceneId,
			cameraId: stage.cameraMode.id,
			isProjectorMode: palette === PROJECTOR_PALETTE,
		});
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
}

function sinksFor(settings: Settings, browserSynth: ToneOutput, midiPorts: readonly MIDIOutput[]): ScoreSink[] {
	const port = midiPorts.find((candidate) => candidate.id === settings.midiPortId);
	return [
		...(settings.browserSynth ? [browserSynth] : []),
		...(port === undefined ? [] : [new WebMidiOutput(port, settings.channelLayout)]),
	];
}

function download(bytes: Uint8Array, filename: string): void {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/midi" }));
	const link = Object.assign(document.createElement("a"), { href: url, download: filename });
	link.click();
	URL.revokeObjectURL(url);
}

/** Runs an async UI action, surfacing failures instead of leaving a floating promise. */
function guard(action: () => Promise<void>): void {
	action().catch(showError);
}

function showError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	element("error", HTMLElement).textContent = message;
	console.error(error);
}

main().catch(showError);
