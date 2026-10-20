import type { Scene, SceneId } from "./scene";

/** The one place that lists the available scenes, in the order of their number keys. */
export class SceneRegistry {
	private readonly scenes = new Map<SceneId, Scene>();

	register(scene: Scene): this {
		if (this.scenes.has(scene.id)) throw new Error(`scene "${scene.id}" registered twice`);
		this.scenes.set(scene.id, scene);
		return this;
	}

	get(id: SceneId): Scene {
		const scene = this.scenes.get(id);
		if (scene === undefined) throw new Error(`unknown scene "${id}"`);
		return scene;
	}

	/** Scenes in registration order; scene n is on key n + 1. */
	list(): readonly Scene[] {
		return [...this.scenes.values()];
	}
}
