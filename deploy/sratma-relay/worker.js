// SRATMA (sratma.mtc.gob.pe) drops connections from AWS but answers
// Cloudflare's egress, so the scraper reaches it through this Worker when it
// runs outside Cloudflare (SRATMA_RELAY_URL). It only relays GETs under the
// SRATMA map API, and only for the IPs in ALLOWED_CLIENT_IPS: Cloudflare sets
// cf-connecting-ip itself, so a client cannot spoof it.
const SRATMA_ORIGIN = "https://sratma.mtc.gob.pe";
const SRATMA_API_PATH_PREFIX = "/wssratma/api/Mapa/";

export default {
	async fetch(request, env) {
		const allowedClientIps = (env.ALLOWED_CLIENT_IPS ?? "")
			.split(",")
			.map((clientIp) => clientIp.trim())
			.filter(Boolean);
		if (
			!allowedClientIps.includes(request.headers.get("cf-connecting-ip") ?? "")
		) {
			return new Response("Forbidden", { status: 403 });
		}
		const requestUrl = new URL(request.url);
		if (
			request.method !== "GET" ||
			!requestUrl.pathname.startsWith(SRATMA_API_PATH_PREFIX)
		) {
			return new Response("Not found", { status: 404 });
		}
		const upstreamResponse = await fetch(
			`${SRATMA_ORIGIN}${requestUrl.pathname}${requestUrl.search}`,
			{
				headers: {
					accept: request.headers.get("accept") ?? "application/json",
					"user-agent":
						request.headers.get("user-agent") ?? "illapa-sratma-relay",
				},
			},
		);
		return new Response(upstreamResponse.body, {
			status: upstreamResponse.status,
			headers: {
				"content-type":
					upstreamResponse.headers.get("content-type") ?? "application/json",
			},
		});
	},
};
