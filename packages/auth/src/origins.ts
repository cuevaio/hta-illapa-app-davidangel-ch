export function parseAllowedOrigins(commaSeparatedOrigins: string): string[] {
	return commaSeparatedOrigins
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

// `*` never spans a dot, so a preview pattern such as
// https://illapa-app-*-team.vercel.app cannot be satisfied by another domain.
// better-auth's own trustedOrigins globbing is looser, so CORS stays the gate.
export function createOriginMatcher(
	allowedOrigins: string[],
): (origin: string) => boolean {
	const allowedOriginPatterns = allowedOrigins.map(
		(allowedOrigin) =>
			new RegExp(
				`^${allowedOrigin
					.split("*")
					.map((literalPart) =>
						literalPart.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
					)
					.join("[a-z0-9-]*")}$`,
			),
	);
	return (origin) =>
		allowedOriginPatterns.some((allowedOriginPattern) =>
			allowedOriginPattern.test(origin),
		);
}
