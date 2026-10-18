import { describe, expect, it } from "vitest";
import { shouldInstallEmulator } from "./emulator-guard";

describe("local emulator guard", () => {
	it.each(["localhost", "127.0.0.1"])(
		"allows %s when native immersive AR is unavailable, including a missing XR system",
		(hostname) => {
			expect(shouldInstallEmulator(hostname, false)).toBe(true);
		},
	);

	it.each(["localhost", "127.0.0.1"])(
		"preserves a native AR runtime on %s, including a Quest over adb reverse",
		(hostname) => {
			expect(shouldInstallEmulator(hostname, true)).toBe(false);
		},
	);

	it.each(["illapa.pe", "192.168.1.2", "[::1]", "localhost.example.com", ""])(
		"never installs on %s",
		(hostname) => {
			expect(shouldInstallEmulator(hostname, false)).toBe(false);
			expect(shouldInstallEmulator(hostname, true)).toBe(false);
		},
	);
});
