import type { Scenario } from "../../scenario/scenario";
import {
	decodeFrame,
	type RemoteFrame,
	type RemoteTransport,
	type SubmitOptions,
} from "./protocol";

/**
 * HTTP + WebSocket transport for the protocol in protocol.ts. Skeleton: no server implements it yet,
 * so it has never run against one.
 */
export class HttpTransport implements RemoteTransport {
	constructor(private readonly baseUrl: string) {}

	async submit(scenario: Scenario, options: SubmitOptions): Promise<string> {
		const res = await fetch(new URL("simulations", this.base()), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ scenario, options }),
		});
		if (!res.ok)
			throw new Error(`Remote solver rejected the scenario (${res.status})`);
		const { id } = (await res.json()) as { id: string };
		return id;
	}

	async *frames(jobId: string): AsyncIterable<RemoteFrame> {
		const url = new URL(
			`simulations/${encodeURIComponent(jobId)}/frames`,
			this.base(),
		);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(url);
		ws.binaryType = "arraybuffer";
		const queue: RemoteFrame[] = [];
		let done = false;
		let failure: Error | null = null;
		let wake: (() => void) | null = null;
		const notify = () => {
			wake?.();
			wake = null;
		};
		ws.onmessage = (e) => {
			try {
				queue.push(decodeFrame(e.data as ArrayBuffer));
			} catch (err) {
				failure = err instanceof Error ? err : new Error(String(err));
				ws.close();
			}
			notify();
		};
		ws.onerror = () => {
			failure = new Error("Remote solver connection failed");
			notify();
		};
		ws.onclose = () => {
			done = true;
			notify();
		};
		try {
			while (true) {
				if (queue.length) yield queue.shift()!;
				else if (failure) throw failure;
				else if (done) return;
				else await new Promise<void>((r) => (wake = r));
			}
		} finally {
			ws.close();
		}
	}

	async cancel(jobId: string): Promise<void> {
		await fetch(
			new URL(`simulations/${encodeURIComponent(jobId)}`, this.base()),
			{ method: "DELETE" },
		).catch(() => undefined);
	}

	private base(): string {
		return this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
	}
}
