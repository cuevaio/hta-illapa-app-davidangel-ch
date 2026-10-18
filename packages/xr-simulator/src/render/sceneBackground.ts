import { Color3, type Scene } from "@babylonjs/core";
import { readVrTheme } from "../ui/vr/theme";

/**
 * Behind the map and the terrain is the page's `background` token (Mayu, docs/DESIGN.md),
 * followed when the host switches light/dark (`.dark` on <html>) for the scene's lifetime.
 */
export function followPageBackground(
	scene: Scene,
	apply: (background: Color3) => void,
): void {
	const read = () =>
		Color3.FromHexString(readVrTheme().colors.background.slice(0, 7));
	apply(read());
	const observer = new MutationObserver(() => apply(read()));
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class", "style", "data-theme"],
	});
	scene.onDisposeObservable.add(() => observer.disconnect());
}
