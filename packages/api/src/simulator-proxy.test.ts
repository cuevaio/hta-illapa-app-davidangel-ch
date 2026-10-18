import { afterEach, describe, expect, it, vi } from "vitest";

import {
	HTTP_STATUS_BAD_GATEWAY,
	HTTP_STATUS_FORBIDDEN,
	HTTP_STATUS_NOT_FOUND,
} from "./constants";
import { proxySimulatorRequest } from "./simulator-proxy";

const log = { set: vi.fn() };
const upstreamFetch = vi.fn<typeof fetch>();

afterEach(() => {
	vi.clearAllMocks();
});

function proxy(role: string | undefined, url: string, headers?: HeadersInit) {
	return proxySimulatorRequest({
		request: new Request(url, { headers }),
		role,
		pathPrefix: "/tiles-api",
		upstreamBaseUrl: "http://tiles.internal:8080",
		upstreamPaths: ["/tiles/", "/capas", "/salud"],
		service: "tiles",
		log,
		fetch: upstreamFetch,
	});
}

describe("simulator backend proxy", () => {
	it.each([
		{ label: "fleet", role: "fleet" },
		{ label: "no role", role: undefined },
	])("rejects $label users without calling the backend", async ({ role }) => {
		const response = await proxy(
			role,
			"https://api.illapa.app/tiles-api/tiles/terreno/v1/9/146/273",
		);

		expect(response.status).toBe(HTTP_STATUS_FORBIDDEN);
		expect(await response.json()).toEqual({
			error: "forbidden",
			message: "Only engineers can use the simulators.",
		});
		expect(upstreamFetch).not.toHaveBeenCalled();
		expect(log.set).toHaveBeenCalledWith({
			simulatorProxy: { service: "tiles", gate: "denied" },
		});
	});

	it("forwards engineer requests to the backend path and query without credentials", async () => {
		upstreamFetch.mockResolvedValue(
			new Response("png-bytes", {
				status: 200,
				headers: {
					"content-type": "image/png",
					"cache-control": "public, max-age=31536000, immutable",
					"set-cookie": "upstream=1",
				},
			}),
		);

		const response = await proxy(
			"engineer",
			"https://api.illapa.app/tiles-api/tiles/terreno/v1/9/146/273?debug=1",
			{ cookie: "session=secret", authorization: "Bearer secret" },
		);

		const [forwardedUrl, forwardedInit] = upstreamFetch.mock.calls[0] ?? [];
		expect(forwardedUrl).toBe(
			"http://tiles.internal:8080/tiles/terreno/v1/9/146/273?debug=1",
		);
		const forwardedHeaders = new Headers(forwardedInit?.headers);
		expect(forwardedHeaders.has("cookie")).toBe(false);
		expect(forwardedHeaders.has("authorization")).toBe(false);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("png-bytes");
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(response.headers.has("set-cookie")).toBe(false);
		expect(log.set).toHaveBeenCalledWith({
			simulatorProxy: { service: "tiles", status: 200 },
		});
	});

	it.each([
		"/tiles-api/metrics",
		"/tiles-api/diagnostico",
		"/tiles-api/",
		"/tiles-api/capasX",
	])(
		"answers 404 to engineers for %s, which the viewer never requests",
		async (path) => {
			const response = await proxy("engineer", `https://api.illapa.app${path}`);

			expect(response.status).toBe(HTTP_STATUS_NOT_FOUND);
			expect(await response.json()).toEqual({ error: "not_found" });
			expect(upstreamFetch).not.toHaveBeenCalled();
		},
	);

	it("passes backend error statuses through", async () => {
		upstreamFetch.mockResolvedValue(
			Response.json({ error: "fuera_de_rango" }, { status: 404 }),
		);

		const response = await proxy(
			"engineer",
			"https://api.illapa.app/tiles-api/tiles/terreno/v1/30/0/0",
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "fuera_de_rango" });
	});

	it("answers 502 when the backend is unreachable", async () => {
		upstreamFetch.mockRejectedValue(new TypeError("fetch failed"));

		const response = await proxy(
			"engineer",
			"https://api.illapa.app/tiles-api/capas",
		);

		expect(response.status).toBe(HTTP_STATUS_BAD_GATEWAY);
		expect(await response.json()).toEqual({
			error: "simulator_backend_unavailable",
			service: "tiles",
		});
		expect(log.set).toHaveBeenCalledWith({
			simulatorProxy: {
				service: "tiles",
				status: HTTP_STATUS_BAD_GATEWAY,
				error: "TypeError",
			},
		});
	});
});
