import { canUseSimulators } from "@hack-the-andes-project/business/simulators";

import { HTTP_STATUS_BAD_GATEWAY, HTTP_STATUS_FORBIDDEN } from "./constants";
import type { Context } from "./context";

// Only what the tiles/weather backends use for content negotiation and
// revalidation; the session cookie and any credentials stay on this server.
const FORWARDED_REQUEST_HEADERS = [
	"accept",
	"if-none-match",
	"if-modified-since",
];

// fetch() already decoded the body, so the upstream encoding and length no
// longer describe it; upstream cookies must never reach the browser.
const DROPPED_RESPONSE_HEADERS = [
	"set-cookie",
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
];

export interface SimulatorProxyInput {
	request: Request;
	role: string | null | undefined;
	pathPrefix: string;
	upstreamBaseUrl: string;
	service: "tiles" | "weather";
	log: Pick<Context["log"], "set">;
	fetch?: typeof fetch;
}

export async function proxySimulatorRequest(input: SimulatorProxyInput) {
	if (!canUseSimulators(input.role)) {
		input.log.set({
			simulatorProxy: { service: input.service, gate: "denied" },
		});
		return Response.json(
			{
				error: "forbidden",
				message: "Only engineers can use the simulators.",
			},
			{ status: HTTP_STATUS_FORBIDDEN },
		);
	}

	const requestUrl = new URL(input.request.url);
	const upstreamPath = requestUrl.pathname.slice(input.pathPrefix.length);
	const upstreamUrl = `${input.upstreamBaseUrl.replace(/\/$/, "")}${upstreamPath}${requestUrl.search}`;
	const forwardedHeaders = new Headers();
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = input.request.headers.get(name);
		if (value) forwardedHeaders.set(name, value);
	}

	try {
		const upstream = await (input.fetch ?? fetch)(upstreamUrl, {
			headers: forwardedHeaders,
			signal: input.request.signal,
		});
		const headers = new Headers(upstream.headers);
		for (const name of DROPPED_RESPONSE_HEADERS) headers.delete(name);
		input.log.set({
			simulatorProxy: { service: input.service, status: upstream.status },
		});
		return new Response(upstream.body, { status: upstream.status, headers });
	} catch (error) {
		input.log.set({
			simulatorProxy: {
				service: input.service,
				status: HTTP_STATUS_BAD_GATEWAY,
				error: error instanceof Error ? error.name : "Error",
			},
		});
		return Response.json(
			{ error: "simulator_backend_unavailable", service: input.service },
			{ status: HTTP_STATUS_BAD_GATEWAY },
		);
	}
}
