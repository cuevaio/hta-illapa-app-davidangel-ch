import { WebXRSessionManager } from "@babylonjs/core";
import { shouldInstallEmulator } from "./emulator-guard";

export interface LocalEmulator {
	dispose(): void;
}

let installation: Promise<LocalEmulator | null> | null = null;
let consumersCount = 0;

export async function acquireLocalEmulator(
	nativeArSupported: boolean,
): Promise<LocalEmulator | null> {
	const hostname = typeof location === "undefined" ? "" : location.hostname;
	if (hostname !== "localhost" && hostname !== "127.0.0.1") return null;
	if (!installation && !shouldInstallEmulator(hostname, nativeArSupported)) {
		return null;
	}
	consumersCount += 1;
	installation ??= (async () => {
		const [
			{ XRDevice, metaQuest3 },
			{ DevUI },
			{ SyntheticEnvironmentModule },
		] = await Promise.all([
			import("iwer"),
			import("@iwer/devui"),
			import("@iwer/sem"),
		]);
		// A native runtime may become available while the emulator chunks load.
		if (await WebXRSessionManager.IsSessionSupportedAsync("immersive-ar")) {
			return null;
		}
		const device = new XRDevice(metaQuest3);
		const dispose = () => {
			if (device.devui instanceof DevUI) device.devui.dispose();
			device.sem?.deleteAll();
			device.sem?.environmentCanvas.remove();
			device.uninstallRuntime();
		};
		try {
			device.installRuntime({ forceInstall: true });
			device.installDevUI(DevUI);
			device.installSEM(SyntheticEnvironmentModule);
			await device.sem?.loadDefaultEnvironment("meeting_room");
			return { dispose };
		} catch (error) {
			dispose();
			throw error;
		}
	})();
	try {
		const emulator = await installation;
		let disposed = false;
		return {
			dispose() {
				if (disposed) return;
				disposed = true;
				consumersCount -= 1;
				if (consumersCount) return;
				emulator?.dispose();
				installation = null;
			},
		};
	} catch (error) {
		consumersCount -= 1;
		if (!consumersCount) installation = null;
		throw error;
	}
}
