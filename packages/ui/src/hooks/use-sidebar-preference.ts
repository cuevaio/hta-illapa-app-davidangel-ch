"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { SIDEBAR_EXPANDED_BREAKPOINT_PX } from "../constants";

interface SidebarPreferenceState {
	storageKey: string;
	choice: boolean | null;
}

interface SidebarPreference {
	open: boolean;
	setOpen: (open: boolean) => void;
}

const useSidebarLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useSidebarPreference(
	storageKey: string,
	defaultOpen?: boolean,
): SidebarPreference {
	const [viewportExpanded, setViewportExpanded] = useState(true);
	const [preference, setPreference] = useState<SidebarPreferenceState>({
		storageKey,
		choice: null,
	});

	useSidebarLayoutEffect(() => {
		const mediaQuery = window.matchMedia(
			`(min-width: ${SIDEBAR_EXPANDED_BREAKPOINT_PX}px)`,
		);
		const updateViewport = () => setViewportExpanded(mediaQuery.matches);
		updateViewport();
		mediaQuery.addEventListener("change", updateViewport);
		return () => mediaQuery.removeEventListener("change", updateViewport);
	}, []);

	useSidebarLayoutEffect(() => {
		const readPreference = () => {
			try {
				const savedChoice = window.localStorage.getItem(storageKey);
				setPreference({
					storageKey,
					choice:
						savedChoice === "true" || savedChoice === "false"
							? savedChoice === "true"
							: null,
				});
			} catch {
				return;
			}
		};
		const handleStorage = (event: StorageEvent) => {
			if (event.key === storageKey || event.key === null) readPreference();
		};
		readPreference();
		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, [storageKey]);

	const setOpen = useCallback(
		(open: boolean) => {
			setPreference({ storageKey, choice: open });
			try {
				window.localStorage.setItem(storageKey, String(open));
			} catch {
				return;
			}
		},
		[storageKey],
	);

	return {
		open:
			(preference.storageKey === storageKey ? preference.choice : null) ??
			defaultOpen ??
			viewportExpanded,
		setOpen,
	};
}
