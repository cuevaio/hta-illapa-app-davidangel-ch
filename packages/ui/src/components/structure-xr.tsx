"use client";

import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { useFrame, useStore } from "@react-three/fiber";
import { createXRStore, useXR, XR, type XRStore } from "@react-three/xr";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import {
	AR_SUPPORT_POLL_INTERVAL_MS,
	AR_SUPPORT_POLL_MAX_ATTEMPTS_COUNT,
	DESKTOP_RESTORE_FRAME_PRIORITY,
} from "./structure-xr/constants";
import {
	type DesktopViewSnapshot,
	restoreDesktopView,
} from "./structure-xr/desktop-view";
import { StructureXrContent } from "./structure-xr/session";

export interface StructureXrLabels {
	placeTable: string;
	undo: string;
	exit: string;
}

export interface StructureXrSessionProps {
	store: XRStore;
	terrain: Terrain;
	focus: { x: number; z: number } | null;
	labels: StructureXrLabels;
	onUndo: () => void;
	children: ReactNode;
}

export function createStructureXrStore(): XRStore {
	const isLoopback =
		typeof window !== "undefined" &&
		(window.location.hostname === "localhost" ||
			window.location.hostname === "127.0.0.1");
	const store = createXRStore({
		offerSession: "immersive-ar",
		enterGrantedSession: ["immersive-ar"],
		handTracking: true,
		hand: { rayPointer: true, grabPointer: true, touchPointer: true },
		controller: { rayPointer: true, grabPointer: true },
		hitTest: "required",
		anchors: true,
		domOverlay: false,
		emulate: isLoopback
			? { syntheticEnvironment: "meeting_room", inject: true }
			: false,
	});
	if (!isLoopback) return store;

	let destroyed = false;
	const unsubscribeEmulator = store.subscribe((state, previousState) => {
		const emulator = state.emulator;
		if (!emulator || emulator === previousState.emulator) return;
		const xrSystem = navigator.xr;
		// IWER 2.6 skips native XRSystem objects even when they cannot run AR.
		void xrSystem?.isSessionSupported("immersive-ar").then(
			(supported) => {
				if (!supported && !destroyed && navigator.xr === xrSystem) {
					emulator.installRuntime({ forceInstall: true });
				}
			},
			() => undefined,
		);
	});
	const destroyStore = store.destroy;
	store.destroy = () => {
		destroyed = true;
		unsubscribeEmulator();
		destroyStore();
	};
	return store;
}

export function useIsArSupported(): boolean {
	const [isSupported, setIsSupported] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let checkedSystem: XRSystem | undefined;
		let attemptsCount = 0;
		const checkSupport = () => {
			attemptsCount += 1;
			if (attemptsCount >= AR_SUPPORT_POLL_MAX_ATTEMPTS_COUNT) {
				window.clearInterval(interval);
			}
			const xrSystem = navigator.xr;
			if (!xrSystem || xrSystem === checkedSystem) return;
			checkedSystem = xrSystem;
			xrSystem.isSessionSupported("immersive-ar").then(
				(supported) => {
					if (!cancelled) setIsSupported(supported);
					if (supported) window.clearInterval(interval);
				},
				() => {
					if (!cancelled) setIsSupported(false);
				},
			);
		};
		// IWER installs navigator.xr asynchronously after the store is created.
		const interval = window.setInterval(
			checkSupport,
			AR_SUPPORT_POLL_INTERVAL_MS,
		);
		checkSupport();
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, []);

	return isSupported;
}

export function useIsPresenting(): boolean {
	return useXR((state) => Boolean(state.session));
}

export function StructureXrSession({
	store,
	...props
}: StructureXrSessionProps) {
	const rootStore = useStore();
	const desktopView = useRef<DesktopViewSnapshot | null>(null);
	const restoreOnNextFrame = useRef(false);

	// Capture before XR's passive subscription replaces R3F's desktop camera.
	useLayoutEffect(
		() =>
			store.subscribe((state, previousState) => {
				if (state.session === previousState.session) return;
				if (state.session) {
					const { camera, controls } = rootStore.getState();
					desktopView.current = {
						camera,
						cameraSnapshot:
							camera instanceof PerspectiveCamera
								? new PerspectiveCamera().copy(camera, false)
								: new OrthographicCamera().copy(camera, false),
						controls,
						controlsTarget:
							controls &&
							"target" in controls &&
							controls.target instanceof Vector3
								? controls.target.clone()
								: null,
						controlsEnabled:
							controls &&
							"enabled" in controls &&
							typeof controls.enabled === "boolean"
								? controls.enabled
								: null,
					};
					restoreOnNextFrame.current = false;
					if (controls && "enabled" in controls) controls.enabled = false;
					return;
				}
				if (desktopView.current) {
					restoreDesktopView(desktopView.current);
					restoreOnNextFrame.current = true;
				}
			}),
		[store, rootStore],
	);

	useFrame(() => {
		if (
			store.getState().session ||
			!restoreOnNextFrame.current ||
			!desktopView.current
		)
			return;
		restoreDesktopView(
			desktopView.current,
			rootStore.getState().controls ?? desktopView.current.controls,
		);
		restoreOnNextFrame.current = false;
	}, DESKTOP_RESTORE_FRAME_PRIORITY);

	return (
		<XR store={store}>
			<StructureXrContent {...props} />
		</XR>
	);
}
