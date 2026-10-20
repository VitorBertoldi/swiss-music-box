import type { CameraModeId } from "../camera/camera";
import type { Scene, SceneId } from "../scenes/scene";
import { button, element } from "./dom";

export interface ViewHandlers {
	showScene(id: SceneId): void;
	useCamera(id: CameraModeId): void;
	toggleProjectorMode(): void;
}

export interface ViewDisplay {
	readonly sceneId: SceneId;
	readonly cameraId: CameraModeId;
	readonly isProjectorMode: boolean;
}

/** Camera buttons with their keyboard shortcut; "free" is entered by moving the map. */
export const CAMERA_CHOICES: readonly { readonly id: CameraModeId; readonly label: string; readonly key: string }[] = [
	{ id: "overview", label: "Overview", key: "o" },
	{ id: "tour", label: "Tour", key: "t" },
	{ id: "follow", label: "Follow a train", key: "g" },
	{ id: "free", label: "Free (drag the map)", key: "m" },
];

/** Scene buttons (numbered like their keys), camera modes, projector mode, fullscreen. */
export class ViewControls {
	private readonly sceneButtons = new Map<SceneId, HTMLButtonElement>();
	private readonly cameraButtons = new Map<CameraModeId, HTMLButtonElement>();
	private readonly projectorButton = element("projector", HTMLButtonElement);

	constructor(scenes: readonly Scene[], handlers: ViewHandlers) {
		const sceneRow = element("scenes", HTMLElement);
		scenes.forEach((scene, index) => {
			const sceneButton = button(`${index + 1} · ${scene.title}`, () => handlers.showScene(scene.id));
			this.sceneButtons.set(scene.id, sceneButton);
			sceneRow.append(sceneButton);
		});
		const cameraRow = element("cameras", HTMLElement);
		for (const choice of CAMERA_CHOICES) {
			const cameraButton = button(`${choice.label} (${choice.key.toUpperCase()})`, () => handlers.useCamera(choice.id));
			this.cameraButtons.set(choice.id, cameraButton);
			cameraRow.append(cameraButton);
		}
		this.projectorButton.addEventListener("click", handlers.toggleProjectorMode);
		element("fullscreen", HTMLButtonElement).addEventListener("click", () => {
			document.documentElement.requestFullscreen().catch(() => undefined);
		});
	}

	update(display: ViewDisplay): void {
		for (const [id, sceneButton] of this.sceneButtons) {
			sceneButton.setAttribute("aria-pressed", String(id === display.sceneId));
		}
		for (const [id, cameraButton] of this.cameraButtons) {
			cameraButton.setAttribute("aria-pressed", String(id === display.cameraId));
		}
		this.projectorButton.setAttribute("aria-pressed", String(display.isProjectorMode));
	}
}
