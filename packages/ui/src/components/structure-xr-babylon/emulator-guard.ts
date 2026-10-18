export function shouldInstallEmulator(
	hostname: string,
	nativeArSupported: boolean,
): boolean {
	return (
		(hostname === "localhost" || hostname === "127.0.0.1") && !nativeArSupported
	);
}
