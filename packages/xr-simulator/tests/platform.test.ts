import { describe, expect, it } from "vitest";
import { type CapabilityReport, summarize } from "../src/platform/capabilities";
import { classifyDevice } from "../src/platform/device";
import { checkSmokeOutput, smokeInput } from "../src/platform/gpuSmokeTest";
import {
	cellBufferBytes,
	pickDefaultProfile,
	QUEST_TARGET_FPS,
} from "../src/platform/quality";

const QUEST_UA =
	"Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.0 Chrome/140 Safari/537.36";
const DESKTOP_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36";
const PHONE_UA =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Mobile Safari/537.36";
const ANDROID_TABLET_UA =
	"Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36";
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

function report(overrides: Partial<CapabilityReport> = {}): CapabilityReport {
	return {
		timestamp: "",
		userAgent: DESKTOP_UA,
		device: "desktop",
		devicePixelRatio: 1,
		screen: { width: 1920, height: 1080 },
		touch: false,
		gpu: {
			apiPresent: true,
			adapterFound: true,
			features: [],
			limits: { maxStorageBufferBindingSize: 134217728 },
		},
		xr: {
			apiPresent: true,
			secureContext: true,
			immersiveVr: false,
			immersiveAr: false,
			gpuBinding: false,
			gpuSubImageViewDescriptor: false,
		},
		...overrides,
	};
}

describe("classifyDevice", () => {
	it.each([
		[QUEST_UA, 0, "quest"],
		[DESKTOP_UA, 0, "desktop"],
		[PHONE_UA, 5, "mobile"],
		[ANDROID_TABLET_UA, 5, "tablet"],
		[MAC_UA, 0, "desktop"],
		[MAC_UA, 5, "tablet"],
	] as const)(
		"%s with %i touch points -> %s",
		(userAgent, maxTouchPoints, expected) => {
			expect(classifyDevice({ userAgent, maxTouchPoints })).toBe(expected);
		},
	);
});

describe("pickDefaultProfile", () => {
	it("uses the reduced 128 profile without WebGPU", () => {
		expect(
			pickDefaultProfile({ device: "desktop", hasWebGPU: false })
				.solverResolution,
		).toBe(128);
	});
	it("defaults per device and never to ultra", () => {
		expect(pickDefaultProfile({ device: "desktop", hasWebGPU: true }).id).toBe(
			"high",
		);
		expect(pickDefaultProfile({ device: "tablet", hasWebGPU: true }).id).toBe(
			"medium",
		);
		expect(pickDefaultProfile({ device: "mobile", hasWebGPU: true }).id).toBe(
			"low",
		);
	});
	it("targets 72 fps on Quest", () => {
		const p = pickDefaultProfile({ device: "quest", hasWebGPU: true });
		expect(p.id).toBe("medium");
		expect(p.targetFps).toBe(QUEST_TARGET_FPS);
	});
	it("steps down when the adapter cannot bind the cell buffer", () => {
		const limit = cellBufferBytes(192);
		expect(
			pickDefaultProfile({
				device: "desktop",
				hasWebGPU: true,
				maxStorageBufferBindingSize: limit,
			}).id,
		).toBe("medium");
		expect(
			pickDefaultProfile({
				device: "desktop",
				hasWebGPU: true,
				maxStorageBufferBindingSize: 1,
			}).id,
		).toBe("low");
	});
});

describe("summarize", () => {
	it("falls back without a WebGPU adapter", () => {
		const s = summarize(
			report({
				gpu: {
					apiPresent: false,
					adapterFound: false,
					features: [],
					limits: {},
				},
			}),
		);
		expect(s.solverBackend).toBe("fallback");
		expect(s.defaultQuality.solverResolution).toBe(128);
	});
	it("shows the VR button only when immersive-vr is confirmed", () => {
		expect(summarize(report()).showVrButton).toBe(false);
		const xr = { ...report().xr, immersiveVr: null };
		expect(summarize(report({ xr })).showVrButton).toBe(false);
		expect(
			summarize(report({ xr: { ...xr, immersiveVr: true } })).showVrButton,
		).toBe(true);
	});
	it("flags XR that would need a WebGL renderer when WebGPU/XR interop is missing", () => {
		const xr = { ...report().xr, immersiveVr: true };
		expect(summarize(report({ xr })).xrNeedsWebGLRenderer).toBe(true);
		expect(
			summarize(
				report({
					xr: { ...xr, gpuBinding: true, gpuSubImageViewDescriptor: true },
				}),
			).xrNeedsWebGLRenderer,
		).toBe(false);
	});
});

describe("checkSmokeOutput", () => {
	it("accepts the exact in*2+1 output and counts mismatches", () => {
		const input = smokeInput();
		const good = input.map((v) => v * 2 + 1);
		expect(checkSmokeOutput(input, good, 0).ok).toBe(true);
		good[10] = 0;
		good[20] = 0;
		expect(checkSmokeOutput(input, good, 0)).toMatchObject({
			ok: false,
			mismatches: 2,
		});
	});
});

describe("engine choice for XR", () => {
	const vr = { ...report().xr, immersiveVr: true };
	it("starts on the WebGL/CPU path when VR is offered without WebGPU/XR interop", () => {
		const s = summarize(report({ xr: vr }));
		expect(s.solverBackend).toBe("fallback");
		expect(s.fallbackReason).toBe("xr-compat");
	});
	it("keeps WebGPU when the interop exists, or when forced", () => {
		expect(
			summarize(
				report({
					xr: { ...vr, gpuBinding: true, gpuSubImageViewDescriptor: true },
				}),
			).solverBackend,
		).toBe("webgpu");
		expect(
			summarize(report({ xr: vr }), { forceWebGPU: true }).solverBackend,
		).toBe("webgpu");
	});
	it("keeps WebGPU on the web without immersive support, and reports why it falls back otherwise", () => {
		expect(summarize(report()).solverBackend).toBe("webgpu");
		expect(summarize(report()).fallbackReason).toBeNull();
		expect(
			summarize(
				report({
					gpu: {
						apiPresent: false,
						adapterFound: false,
						features: [],
						limits: {},
					},
				}),
			).fallbackReason,
		).toBe("no-webgpu");
	});
});

describe("engine choice on ordinary devices", () => {
	const ar = { ...report().xr, immersiveAr: true };
	it("keeps WebGPU on phones and tablets that offer AR/VR without WebGPU interop", () => {
		expect(summarize(report({ device: "mobile", xr: ar })).solverBackend).toBe(
			"webgpu",
		);
		expect(
			summarize(report({ device: "tablet", xr: { ...ar, immersiveVr: true } }))
				.solverBackend,
		).toBe("webgpu");
	});
	it("uses the VR-compatible path on headsets and on desktop with an XR emulator", () => {
		const vr = { ...report().xr, immersiveVr: true };
		expect(summarize(report({ device: "quest", xr: vr })).fallbackReason).toBe(
			"xr-compat",
		);
		expect(
			summarize(report({ device: "desktop", xr: vr })).fallbackReason,
		).toBe("xr-compat");
	});
});
