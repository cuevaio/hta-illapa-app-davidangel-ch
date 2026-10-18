/** Minimal on-screen log so XR test results are readable on a headset without devtools. */
export class TestOverlay {
	private readonly log: HTMLPreElement;
	readonly buttons: HTMLDivElement;
	private readonly lines: string[] = [];

	constructor(root: HTMLElement, title: string) {
		const h = document.createElement("h2");
		h.textContent = title;
		this.buttons = document.createElement("div");
		this.buttons.className = "row";
		this.log = document.createElement("pre");
		const back = document.createElement("a");
		back.href = "./diagnostics.html";
		back.textContent = "← Diagnóstico";
		root.append(h, this.buttons, this.log, back);
	}

	write(line: string): void {
		const stamp = new Date().toLocaleTimeString("es");
		this.lines.push(`[${stamp}] ${line}`);
		this.log.textContent = this.lines.join("\n");
		this.log.scrollTop = this.log.scrollHeight;
		console.info("[xr-test]", line);
	}

	addButton(label: string, onClick: () => void): HTMLButtonElement {
		const btn = document.createElement("button");
		btn.textContent = label;
		btn.onclick = onClick;
		this.buttons.append(btn);
		return btn;
	}
}
