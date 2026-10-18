import { Scene } from "@babylonjs/core";
import type {
	ImageryMode,
	ImagerySource,
	ModeHost,
	SimulatorMode,
	SiteTerrain,
} from "@hack-the-andes-project/xr-simulator/viewer";
import type { StructureSceneProps } from "../../lib/structure-scene";
import type { StructureXrController } from "../../lib/structure-xr-babylon";
import { createStructureXr } from "../structure-xr-babylon";
import type { ScenePalette } from "./models";
import { StructureSceneRuntime } from "./runtime";

export const STRUCTURES_MODE_ID = "structures";

export interface StructuresModeOptions {
	entryLabel: string;
	props: () => StructureSceneProps;
	palette: () => ScenePalette;
}

interface StructuresScene {
	scene: Scene;
	terrain: SiteTerrain;
	runtime: StructureSceneRuntime;
	xr: Promise<StructureXrController>;
	removeBlurObserver: () => void;
}

/**
 * The structures (bridge, tunnel, bypass) simulator as a mode of the xr-simulator viewer: the
 * structure runtime in its own right-handed scene on the viewer's engine, over the viewer's
 * real relief around the structures origin, with its AR maquette joining the viewer's XR session.
 */
export class StructuresMode implements SimulatorMode {
	readonly id = STRUCTURES_MODE_ID;
	readonly entryLabel: string;
	private resources: StructuresScene | null = null;
	private presentingXr = false;
	private xrRequestId: number | undefined;
	private disposed = false;

	constructor(
		private readonly host: ModeHost,
		private readonly options: StructuresModeOptions,
	) {
		this.entryLabel = options.entryLabel;
	}

	async start() {}

	async open() {
		this.build();
		this.host.showMode(this.id);
	}

	show() {
		const { scene, runtime } = this.build();
		scene.attachControl();
		if (!this.presentingXr) runtime.camera.camera.attachControl(false);
	}

	hide() {
		const resources = this.resources;
		if (!resources) return;
		resources.runtime.clearPointer();
		resources.runtime.camera.camera.detachControl();
		resources.scene.detachControl();
	}

	frame() {
		const resources = this.resources;
		if (!resources) return;
		try {
			resources.scene.render();
		} catch {
			resources.runtime.setStatus("error");
		}
	}

	presenting() {
		return this.presentingXr;
	}

	handleKey() {}

	notify(message: string | null) {
		this.resources?.runtime.labels.setStatus(message ?? "");
	}

	imageryChanged(_mode: ImageryMode, source: ImagerySource | null) {
		this.resources?.terrain.setImagery(source);
	}

	imageryAttribution() {}

	update(props: StructureSceneProps, palette: ScenePalette) {
		const resources = this.resources;
		if (!resources) return;
		resources.runtime.update(props, palette);
		if (props.xrRequest && props.xrRequest.requestId !== this.xrRequestId) {
			this.xrRequestId = props.xrRequest.requestId;
			void resources.xr
				.then((controller) => {
					if (this.resources === resources) return controller.enter();
				})
				.catch(() =>
					resources.runtime.labels.setStatus(props.labels.terrainError),
				);
		}
	}

	retryTerrain() {
		if (this.resources) this.loadTerrain(this.resources);
	}

	dispose() {
		this.disposed = true;
		const resources = this.resources;
		if (!resources) return;
		this.resources = null;
		resources.removeBlurObserver();
		void resources.xr.then((controller) => controller.dispose());
		resources.runtime.dispose();
		resources.scene.dispose();
	}

	private build(): StructuresScene {
		if (this.resources) return this.resources;
		const props = this.options.props();
		const scene = new Scene(this.host.engine);
		scene.useRightHandedSystem = true;
		scene.detachControl();
		const terrain = this.host.createSiteTerrain({
			scene,
			origin: props.origin,
			onLoaded: () => this.resources?.runtime.markTerrainDirty(),
		});
		const runtime = new StructureSceneRuntime(
			scene,
			terrain,
			props,
			this.options.palette(),
		);
		runtime.camera.camera.detachControl();
		const blurObserver = this.host.engine.onCanvasBlurObservable.add(() =>
			runtime.clearPointer(),
		);
		const latest = () => this.options.props();
		const xr = createStructureXr({
			scene,
			terrain,
			content: runtime.content,
			getFocus: () => {
				const current = latest();
				const selected = current.structures.find(
					(structure) => structure.id === current.selectedStructureId,
				);
				return selected ? terrain.toLocal(selected.anchor) : null;
			},
			labels: {
				placeTable: props.labels.placeTable,
				undo: props.labels.undo,
				exit: props.labels.exitXr,
				error: props.labels.terrainError,
			},
			webgpu: this.host.webgpu,
			join: (member) =>
				this.host.vr.started(
					{
						member,
						enter: () => xr.then((controller) => controller.enter()),
						pause: () => runtime.content.setEnabled(false),
						resume: () => runtime.content.setEnabled(true),
					},
					"immersive-ar",
				),
			onUndo: () => latest().onUndo(),
			onSupportChange: (supported) => {
				if (!this.disposed) latest().onXrSupportChange(supported);
			},
			onSessionChange: (active) => {
				if (this.disposed) return;
				this.presentingXr = active;
				runtime.setPresenting(active);
				latest().onXrSessionChange(active);
			},
			onError: () => {
				if (!this.disposed)
					runtime.labels.setStatus(latest().labels.terrainError);
			},
		});
		const resources: StructuresScene = {
			scene,
			terrain,
			runtime,
			xr,
			removeBlurObserver: () => blurObserver.remove(),
		};
		this.resources = resources;
		this.loadTerrain(resources);
		return resources;
	}

	private loadTerrain(resources: StructuresScene) {
		resources.runtime.setStatus("loading");
		resources.terrain.load().catch(() => {
			if (this.resources === resources) resources.runtime.setStatus("error");
		});
	}
}
