export type DeviceClass = "quest" | "mobile" | "tablet" | "desktop";

export interface DeviceHints {
	userAgent: string;
	maxTouchPoints: number;
}

/** Classifies the device from cheap, synchronous hints. Pure for testability. */
export function classifyDevice({
	userAgent,
	maxTouchPoints,
}: DeviceHints): DeviceClass {
	if (/OculusBrowser|Quest/i.test(userAgent)) return "quest";
	if (/iPhone|iPod/i.test(userAgent)) return "mobile";
	if (/Android/i.test(userAgent))
		return /Mobile/i.test(userAgent) ? "mobile" : "tablet";
	if (/iPad/i.test(userAgent)) return "tablet";
	// iPadOS reports a desktop Safari UA; touch points give it away.
	if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "tablet";
	return "desktop";
}

export function currentDeviceHints(): DeviceHints {
	return {
		userAgent: navigator.userAgent,
		maxTouchPoints: navigator.maxTouchPoints ?? 0,
	};
}
