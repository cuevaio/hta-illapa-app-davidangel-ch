import type { XRStoreOptions } from "@react-three/xr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStructureXrStore } from "../structure-xr";

type MockCreateStore = (options: XRStoreOptions) => unknown;

interface MockEmulator {
	installRuntime: ReturnType<typeof vi.fn>;
}

interface MockXrState {
	emulator?: MockEmulator;
}

type MockStateListener = (
	state: MockXrState,
	previousState: MockXrState,
) => void;

interface StoreHarnessOptions {
	hostname?: string;
	support?: Promise<boolean>;
	browser?: boolean;
}

const xrMocks = vi.hoisted(() => ({ createStore: vi.fn<MockCreateStore>() }));

vi.mock("@react-three/xr", () => ({ createXRStore: xrMocks.createStore }));
vi.mock("./session", () => ({ StructureXrContent: () => null }));

function createStoreHarness({
	hostname = "localhost",
	support = Promise.resolve(false),
	browser = true,
}: StoreHarnessOptions = {}) {
	vi.stubGlobal("window", browser ? { location: { hostname } } : undefined);
	const xrSystem = { isSessionSupported: vi.fn(() => support) };
	const navigator = { xr: xrSystem };
	vi.stubGlobal("navigator", navigator);
	const emulator = { installRuntime: vi.fn() };
	const listeners = new Set<MockStateListener>();
	const destroy = vi.fn();
	const subscribe = vi.fn((listener: MockStateListener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	});
	xrMocks.createStore.mockReturnValue({ subscribe, destroy });
	const store = createStructureXrStore();
	let state: MockXrState = {};
	return {
		store,
		destroy,
		emulator,
		xrSystem,
		navigator,
		listeners,
		subscribe,
		emitEmulator() {
			const previousState = state;
			state = { emulator };
			for (const listener of listeners) listener(state, previousState);
		},
	};
}

beforeEach(() => xrMocks.createStore.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("IWER runtime guard", () => {
	it.each(["localhost", "127.0.0.1"])(
		"replaces unsupported native XR only on %s",
		async (hostname) => {
			const harness = createStoreHarness({ hostname });
			expect(xrMocks.createStore.mock.calls[0]?.[0].emulate).toMatchObject({
				inject: true,
				syntheticEnvironment: "meeting_room",
			});
			harness.emitEmulator();
			expect(harness.xrSystem.isSessionSupported).toHaveBeenCalledWith(
				"immersive-ar",
			);
			await Promise.resolve();
			expect(harness.emulator.installRuntime).toHaveBeenCalledExactlyOnceWith({
				forceInstall: true,
			});
		},
	);

	it.each(["localhost", "127.0.0.1"])(
		"preserves supported Quest AR on %s",
		async (hostname) => {
			const harness = createStoreHarness({
				hostname,
				support: Promise.resolve(true),
			});
			harness.emitEmulator();
			await Promise.resolve();
			expect(harness.emulator.installRuntime).not.toHaveBeenCalled();
		},
	);

	it.each(["illapa.app", "192.168.1.2"])(
		"disables the emulator and its compatibility subscription on %s",
		(hostname) => {
			const harness = createStoreHarness({ hostname });
			expect(xrMocks.createStore.mock.calls[0]?.[0].emulate).toBe(false);
			expect(harness.subscribe).not.toHaveBeenCalled();
		},
	);

	it("disables emulation during SSR", () => {
		const harness = createStoreHarness({ browser: false });
		expect(xrMocks.createStore.mock.calls[0]?.[0].emulate).toBe(false);
		expect(harness.subscribe).not.toHaveBeenCalled();
	});

	it("does not treat a rejected support query as permission to replace native XR", async () => {
		const harness = createStoreHarness({
			support: Promise.reject(new Error("Permission denied")),
		});
		harness.emitEmulator();
		await Promise.resolve();
		expect(harness.emulator.installRuntime).not.toHaveBeenCalled();
	});

	it("preserves a replacement XR system while its previous support query is pending", async () => {
		const harness = createStoreHarness();
		harness.emitEmulator();
		harness.navigator.xr = {
			isSessionSupported: vi.fn(() => Promise.resolve(true)),
		};
		await Promise.resolve();
		expect(harness.emulator.installRuntime).not.toHaveBeenCalled();
	});

	it("cancels pending installation and unsubscribes when destroyed", async () => {
		const harness = createStoreHarness();
		harness.emitEmulator();
		harness.store.destroy();
		await Promise.resolve();
		expect(harness.emulator.installRuntime).not.toHaveBeenCalled();
		expect(harness.listeners.size).toBe(0);
		expect(harness.destroy).toHaveBeenCalledOnce();
	});

	it("checks each emulator instance once", async () => {
		const harness = createStoreHarness();
		harness.emitEmulator();
		harness.emitEmulator();
		await Promise.resolve();
		expect(harness.xrSystem.isSessionSupported).toHaveBeenCalledOnce();
		expect(harness.emulator.installRuntime).toHaveBeenCalledOnce();
	});
});
