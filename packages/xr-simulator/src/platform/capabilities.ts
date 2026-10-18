import { classifyDevice, currentDeviceHints, type DeviceClass } from "./device";
import { pickDefaultProfile, type QualityProfile } from "./quality";

/** Adapter limits that matter for the solver; the full list is also reported. */
export const KEY_LIMITS = [
	"maxStorageBufferBindingSize",
	"maxBufferSize",
	"maxComputeWorkgroupSizeX",
	"maxComputeWorkgroupSizeY",
	"maxComputeInvocationsPerWorkgroup",
	"maxComputeWorkgroupStorageSize",
	"maxStorageBuffersPerShaderStage",
	"maxStorageTexturesPerShaderStage",
	"maxTextureDimension2D",
] as const;

export interface GpuReport {
	apiPresent: boolean;
	adapterFound: boolean;
	error?: string;
	isFallbackAdapter?: boolean;
	adapterInfo?: {
		vendor: string;
		architecture: string;
		device: string;
		description: string;
	};
	features: string[];
	limits: Record<string, number>;
}

export interface XrReport {
	apiPresent: boolean;
	secureContext: boolean;
	immersiveVr: boolean | null;
	immersiveAr: boolean | null;
	/** WebXR/WebGPU interop (`XRGPUBinding`) exposed by the browser. */
	gpuBinding: boolean;
	/** `XRGPUSubImage.prototype.getViewDescriptor`, required by Babylon's WebGPU XR path. */
	gpuSubImageViewDescriptor: boolean;
	error?: string;
}

export interface CapabilityReport {
	timestamp: string;
	userAgent: string;
	device: DeviceClass;
	devicePixelRatio: number;
	screen: { width: number; height: number };
	touch: boolean;
	gpu: GpuReport;
	xr: XrReport;
}

export interface CapabilitySummary {
	solverBackend: "webgpu" | "fallback";
	/**
	 * Why the WebGL2 + CPU path was chosen: no WebGPU at all, or VR is offered but the browser
	 * cannot render XR with WebGPU (no XRGPUBinding), so the app starts on WebGL2 to keep VR usable.
	 */
	fallbackReason: "no-webgpu" | "xr-compat" | null;
	showVrButton: boolean;
	showArButton: boolean;
	/** VR is offered but the browser lacks WebGPU/XR interop, so XR would need a WebGL engine. */
	xrNeedsWebGLRenderer: boolean;
	defaultQuality: QualityProfile;
}

export async function probeGpu(): Promise<GpuReport> {
	// `?nowebgpu` simulates a browser without WebGPU to exercise the fallback path.
	const simulatedOff = new URLSearchParams(location.search).has("nowebgpu");
	const report: GpuReport = {
		apiPresent: !simulatedOff && Boolean(navigator.gpu),
		adapterFound: false,
		features: [],
		limits: {},
	};
	if (simulatedOff)
		report.error = "WebGPU desactivado con ?nowebgpu (simulación).";
	if (!report.apiPresent) return report;
	try {
		const adapter = await navigator.gpu.requestAdapter({
			powerPreference: "high-performance",
		});
		if (!adapter) {
			report.error = "navigator.gpu exists but requestAdapter() returned null";
			return report;
		}
		report.adapterFound = true;
		const info = adapter.info;
		report.adapterInfo = {
			vendor: info?.vendor ?? "",
			architecture: info?.architecture ?? "",
			device: info?.device ?? "",
			description: info?.description ?? "",
		};
		report.isFallbackAdapter =
			(info as GPUAdapterInfo & { isFallbackAdapter?: boolean })
				?.isFallbackAdapter ?? false;
		report.features = [...adapter.features].sort();
		// GPUSupportedLimits is not enumerable as an own object; walk its prototype getters.
		for (const key in adapter.limits) {
			const value = (adapter.limits as unknown as Record<string, unknown>)[key];
			if (typeof value === "number") report.limits[key] = value;
		}
	} catch (err) {
		report.error = String(err);
	}
	return report;
}

export async function probeXr(): Promise<XrReport> {
	const g = globalThis as Record<string, unknown>;
	const subImage = g.XRGPUSubImage as
		| { prototype?: Record<string, unknown> }
		| undefined;
	const report: XrReport = {
		apiPresent: "xr" in navigator && navigator.xr !== undefined,
		secureContext: window.isSecureContext,
		immersiveVr: null,
		immersiveAr: null,
		gpuBinding: typeof g.XRGPUBinding !== "undefined",
		gpuSubImageViewDescriptor:
			typeof subImage?.prototype?.getViewDescriptor === "function",
	};
	if (!report.apiPresent) return report;
	const xr = navigator.xr!;
	const check = async (mode: XRSessionMode) => {
		try {
			return await xr.isSessionSupported(mode);
		} catch (err) {
			report.error = `${mode}: ${String(err)}`;
			return false;
		}
	};
	[report.immersiveVr, report.immersiveAr] = await Promise.all([
		check("immersive-vr"),
		check("immersive-ar"),
	]);
	return report;
}

export async function probeCapabilities(): Promise<CapabilityReport> {
	const hints = currentDeviceHints();
	const [gpu, xr] = await Promise.all([probeGpu(), probeXr()]);
	return {
		timestamp: new Date().toISOString(),
		userAgent: hints.userAgent,
		device: classifyDevice(hints),
		devicePixelRatio: window.devicePixelRatio,
		screen: { width: window.screen.width, height: window.screen.height },
		touch: hints.maxTouchPoints > 0,
		gpu,
		xr,
	};
}

export interface SummaryOptions {
	/** Keep WebGPU even if that leaves VR unavailable (`?forcewebgpu`). */
	forceWebGPU?: boolean;
}

export function summarize(
	report: CapabilityReport,
	opts: SummaryOptions = {},
): CapabilitySummary {
	const showVrButton = report.xr.immersiveVr === true;
	const showArButton = report.xr.immersiveAr === true;
	const xrNeedsWebGLRenderer =
		(showVrButton || showArButton) &&
		!(report.xr.gpuBinding && report.xr.gpuSubImageViewDescriptor);
	// Only devices whose point is VR (headsets) or a desktop running an XR emulator trade WebGPU for
	// VR; phones and tablets that merely offer AR keep the GPU solver and get no XR button instead.
	const xrFirstDevice =
		report.device === "quest" || (report.device === "desktop" && showVrButton);
	const fallbackReason = !report.gpu.adapterFound
		? "no-webgpu"
		: xrNeedsWebGLRenderer && xrFirstDevice && !opts.forceWebGPU
			? "xr-compat"
			: null;
	const hasWebGPU = fallbackReason === null;
	return {
		solverBackend: hasWebGPU ? "webgpu" : "fallback",
		fallbackReason,
		showVrButton,
		showArButton,
		xrNeedsWebGLRenderer,
		defaultQuality: pickDefaultProfile({
			device: report.device,
			hasWebGPU,
			maxStorageBufferBindingSize:
				report.gpu.limits.maxStorageBufferBindingSize,
		}),
	};
}
