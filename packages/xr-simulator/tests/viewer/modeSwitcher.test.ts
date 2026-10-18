import { describe, expect, it } from "vitest";
import {
	ModeSwitcher,
	type SwitchableMode,
} from "../../src/viewer/ModeSwitcher";

function fakeMode(id: string, log: string[]): SwitchableMode {
	return {
		id,
		show: () => log.push(`${id}:show`),
		hide: () => log.push(`${id}:hide`),
		frame: () => log.push(`${id}:frame`),
		dispose: () => log.push(`${id}:dispose`),
	};
}

function setup() {
	const log: string[] = [];
	const screens: string[] = [];
	const overview = {
		show: () => log.push("overview:show"),
		hide: () => log.push("overview:hide"),
		render: () => log.push("overview:render"),
	};
	const switcher = new ModeSwitcher(
		[fakeMode("huayco", log), fakeMode("structures", log)],
		overview,
		(screen) => screens.push(screen),
	);
	return { log, screens, switcher };
}

describe("mode switcher", () => {
	it("starts on the first mode and renders it until the overview is shown", () => {
		const { log, switcher } = setup();
		expect(switcher.overviewActive).toBe(false);
		expect(switcher.active.id).toBe("huayco");
		switcher.frame();
		expect(log).toEqual(["huayco:frame"]);
	});

	it("shows the overview once, hiding the active mode, and renders only the overview", () => {
		const { log, screens, switcher } = setup();
		expect(switcher.showOverview()).toBe(true);
		expect(switcher.showOverview()).toBe(false);
		switcher.frame();
		expect(log).toEqual(["huayco:hide", "overview:show", "overview:render"]);
		expect(screens).toEqual(["overview"]);
		expect(switcher.overviewActive).toBe(true);
	});

	it("opens another mode from the overview and back to the map", () => {
		const { log, screens, switcher } = setup();
		switcher.showOverview();
		log.length = 0;
		switcher.showMode("structures");
		switcher.frame();
		switcher.showOverview();
		expect(log).toEqual([
			"overview:hide",
			"structures:show",
			"structures:frame",
			"structures:hide",
			"overview:show",
		]);
		expect(screens).toEqual(["overview", "structures", "overview"]);
		expect(switcher.active.id).toBe("structures");
	});

	it("switches directly between modes and ignores re-opening the shown one", () => {
		const { log, screens, switcher } = setup();
		switcher.showMode("structures");
		switcher.showMode("structures");
		expect(log).toEqual(["huayco:hide", "structures:show"]);
		expect(screens).toEqual(["structures"]);
	});

	it("rejects unknown modes", () => {
		const { switcher } = setup();
		expect(() => switcher.showMode("tsunami")).toThrow("tsunami");
		expect(switcher.mode("structures")?.id).toBe("structures");
		expect(switcher.mode("tsunami")).toBeUndefined();
	});

	it("disposes every mode once", () => {
		const { log, switcher } = setup();
		switcher.dispose();
		switcher.dispose();
		expect(log).toEqual(["huayco:dispose", "structures:dispose"]);
	});
});
