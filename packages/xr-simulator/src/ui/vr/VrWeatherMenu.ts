import { Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	Button,
	Control,
	Grid,
	Image,
	ScrollViewer,
	StackPanel,
	TextBlock,
} from "@babylonjs/gui";
import { type IconName, iconDataUrl } from "../icons";
import type { WeatherMenuContent } from "../sections";

const ACCENT = "#e8913a";
const BUTTON_BG = "#2a3038";
const MUTED = "#9aa4b1";
const ROW_H_PX = 104;
const ICON_PX = 52;
const SCROLL_BAR_PX = 40;

/** The standalone menu plane over the Peru map (m, texture px). */
const MENU_W_M = 0.5;
const MENU_TEX_W = 1000;
const MENU_TEX_H = 1900;

interface MenuButton {
	button: Button;
	image: Image | null;
	text: TextBlock | null;
	icon: IconName | null;
	source: string;
}

/**
 * "Capas meteorológicas" in VR (S8): every option of the web weather panel (layer toggles,
 * opacity, forecast timeline with play, precipitation scale, legends, provenance, point values
 * and attribution), pressed with the controller ray. Built into any GUI parent: the huayco VR
 * panel shows it as a page, the Peru map as its own floating menu (VrWeatherMenu).
 */
export class VrWeatherSection {
	readonly root = new StackPanel("weather-section");
	private readonly buttons = new Map<string, MenuButton>();
	private readonly opacityCells = new Map<
		string,
		{ down: Button; value: TextBlock; up: Button }
	>();
	private readonly notice: TextBlock;
	private readonly status: TextBlock;
	private readonly timeBox = new StackPanel();
	private readonly timeLabel: TextBlock;
	private readonly rainBox = new StackPanel();
	private readonly legends: TextBlock;
	private readonly values: TextBlock;
	private readonly provenance: TextBlock;
	private readonly credit: TextBlock;
	private shownKey = "";

	constructor(
		initial: WeatherMenuContent,
		private readonly onAction: (id: string) => void,
	) {
		this.root.width = "100%";
		this.root.addControl(this.label("Capas meteorológicas", 40, "white", true));
		this.notice = this.paragraph(26, "#ffcf70");
		this.root.addControl(this.notice);
		for (const layer of initial.layers) {
			const row = new Grid();
			row.height = `${ROW_H_PX}px`;
			row.addColumnDefinition(0.58);
			row.addColumnDefinition(0.12);
			row.addColumnDefinition(0.18);
			row.addColumnDefinition(0.12);
			row.addControl(
				this.button(layer.id, layer.icon, layer.text, ROW_H_PX),
				0,
				0,
			);
			const layerId = layer.id.slice("wx:".length);
			const down = this.button(
				`wx:opacity-down:${layerId}`,
				null,
				"−",
				ROW_H_PX,
			);
			const value = this.label("", 28);
			value.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
			const up = this.button(`wx:opacity-up:${layerId}`, null, "+", ROW_H_PX);
			row.addControl(down, 0, 1);
			row.addControl(value, 0, 2);
			row.addControl(up, 0, 3);
			this.opacityCells.set(layer.id, { down, value, up });
			this.root.addControl(row);
		}
		this.status = this.paragraph(24, MUTED);
		this.root.addControl(this.status);

		this.timeBox.width = "100%";
		this.timeBox.addControl(this.label("Pronóstico", 28, MUTED));
		const timeRow = new Grid();
		timeRow.height = `${ROW_H_PX}px`;
		timeRow.addColumnDefinition(0.25);
		timeRow.addColumnDefinition(0.5);
		timeRow.addColumnDefinition(0.25);
		timeRow.addControl(this.button("wx:prev", "stepBack", "", ROW_H_PX), 0, 0);
		timeRow.addControl(
			this.button("wx:play", "play", "Reproducir", ROW_H_PX),
			0,
			1,
		);
		timeRow.addControl(
			this.button("wx:next", "stepForward", "", ROW_H_PX),
			0,
			2,
		);
		this.timeBox.addControl(timeRow);
		this.timeLabel = this.paragraph(26, "white");
		this.timeBox.addControl(this.timeLabel);
		this.root.addControl(this.timeBox);

		this.rainBox.width = "100%";
		this.rainBox.addControl(this.label("Precipitación", 28, MUTED));
		const rainRow = new Grid();
		rainRow.height = `${ROW_H_PX}px`;
		rainRow.addColumnDefinition(0.5);
		rainRow.addColumnDefinition(0.5);
		(["rate", "accum"] as const).forEach((mode, column) => {
			rainRow.addControl(
				this.button(`wx:rain:${mode}`, "rain", mode, ROW_H_PX),
				0,
				column,
			);
		});
		this.rainBox.addControl(rainRow);
		this.root.addControl(this.rainBox);

		this.legends = this.paragraph(24, "white");
		this.values = this.paragraph(26, "white");
		this.provenance = this.paragraph(22, MUTED);
		this.credit = this.paragraph(20, MUTED);
		for (const block of [
			this.legends,
			this.values,
			this.provenance,
			this.credit,
		])
			this.root.addControl(block);
		this.update(initial);
	}

	update(content: WeatherMenuContent): void {
		const key = JSON.stringify(content);
		if (key === this.shownKey) return;
		this.shownKey = key;
		this.setText(this.notice, content.notice);
		for (const layer of content.layers) {
			this.sync(layer.id, layer.active, layer.disabled);
			const cells = this.opacityCells.get(layer.id);
			if (!cells) continue;
			const shown = layer.opacity !== null;
			cells.down.isVisible = cells.up.isVisible = cells.value.isVisible = shown;
			cells.value.text = layer.opacity ?? "";
		}
		this.setText(this.status, content.status.join("\n") || null);
		this.timeBox.isVisible = content.time !== null;
		if (content.time) {
			this.timeLabel.text = content.time.label;
			const play = this.buttons.get("wx:play");
			if (play?.text)
				play.text.text = content.time.playing ? "Pausa" : "Reproducir";
			if (play) play.icon = content.time.playing ? "pause" : "play";
			this.sync("wx:play", content.time.playing, false);
		}
		this.rainBox.isVisible = content.rain !== null;
		for (const option of content.rain ?? []) {
			const entry = this.buttons.get(option.id);
			if (entry?.text) entry.text.text = option.text;
			this.sync(option.id, option.active, false);
		}
		this.setText(
			this.legends,
			content.legends.map((l) => `${l.title}\n${l.text}`).join("\n\n") || null,
		);
		this.setText(
			this.values,
			content.values.length
				? `En el punto marcado\n${content.values.join("\n")}`
				: null,
		);
		this.setText(
			this.provenance,
			content.provenance.length
				? `Procedencia de los datos\n${content.provenance.join("\n")}`
				: null,
		);
		this.setText(this.credit, content.credit);
	}

	private setText(block: TextBlock, text: string | null): void {
		block.text = text ?? "";
		block.isVisible = text !== null;
	}

	private sync(id: string, active: boolean, disabled: boolean): void {
		const entry = this.buttons.get(id);
		if (!entry) return;
		const color = active ? "#111111" : "#ffffff";
		entry.button.background = active ? ACCENT : BUTTON_BG;
		if (entry.text) entry.text.color = color;
		if (entry.image && entry.icon) {
			const source = iconDataUrl(entry.icon, color);
			if (source !== entry.source) {
				entry.image.source = source;
				entry.source = source;
			}
		}
		entry.button.isEnabled = !disabled;
		entry.button.alpha = disabled ? 0.35 : 1;
	}

	private label(
		text: string,
		size: number,
		color = "white",
		bold = false,
	): TextBlock {
		const block = new TextBlock(undefined, text);
		block.color = color;
		block.fontSize = size;
		block.fontWeight = bold ? "bold" : "normal";
		block.height = `${Math.round(size * 1.6)}px`;
		block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		return block;
	}

	/** Multi-line text that grows with its content inside the stack. */
	private paragraph(size: number, color: string): TextBlock {
		const block = this.label("", size, color);
		block.textWrapping = true;
		block.resizeToFit = true;
		block.paddingTop = "6px";
		block.paddingBottom = "6px";
		return block;
	}

	private button(
		id: string,
		icon: IconName | null,
		text: string,
		heightPx: number,
	): Button {
		const button = new Button();
		button.height = `${heightPx}px`;
		button.background = BUTTON_BG;
		button.cornerRadius = 14;
		button.thickness = 0;
		button.paddingLeft = button.paddingRight = "6px";
		button.paddingTop = button.paddingBottom = "8px";
		const content = new Grid();
		let image: Image | null = null;
		if (icon) {
			content.addColumnDefinition(text ? ICON_PX + 20 : 1, Boolean(text));
			image = new Image();
			image.width = `${ICON_PX}px`;
			image.height = `${ICON_PX}px`;
			image.stretch = Image.STRETCH_UNIFORM;
			image.horizontalAlignment = text
				? Control.HORIZONTAL_ALIGNMENT_RIGHT
				: Control.HORIZONTAL_ALIGNMENT_CENTER;
			content.addControl(image, 0, 0);
		}
		let label: TextBlock | null = null;
		if (text) {
			content.addColumnDefinition(1);
			label = new TextBlock(undefined, text);
			label.fontSize = 30;
			label.color = "white";
			label.paddingLeft = "12px";
			label.paddingRight = "8px";
			label.textHorizontalAlignment = icon
				? Control.HORIZONTAL_ALIGNMENT_LEFT
				: Control.HORIZONTAL_ALIGNMENT_CENTER;
			label.textWrapping = 2; // TextWrapping.Ellipsis (ambient const enum)
			content.addControl(label, 0, icon ? 1 : 0);
		}
		button.addControl(content);
		button.onPointerClickObservable.add(() => {
			if (button.isEnabled) this.onAction(id);
		});
		this.buttons.set(id, { button, image, text: label, icon, source: "" });
		this.sync(id, false, false);
		return button;
	}
}

/**
 * The section in a scroller: with every layer on, its legends and provenance outgrow any panel
 * that still fits the field of view. The bar is wide enough to drag with the controller ray.
 */
export function weatherScroller(
	section: VrWeatherSection,
	height: string,
): ScrollViewer {
	const scroller = new ScrollViewer("weather-scroll");
	scroller.width = "100%";
	scroller.height = height;
	scroller.thickness = 0;
	scroller.barSize = SCROLL_BAR_PX;
	scroller.barColor = ACCENT;
	scroller.barBackground = BUTTON_BG;
	scroller.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	section.root.width = "94%";
	section.root.paddingTop = "16px";
	scroller.addControl(section.root);
	return scroller;
}

/** The weather menu over the Peru map in VR: its own floating plane, toggled with X (S8). */
export class VrWeatherMenu {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly section: VrWeatherSection;

	constructor(
		scene: Scene,
		initial: WeatherMenuContent,
		onAction: (id: string) => void,
	) {
		this.mesh = MeshBuilder.CreatePlane(
			"peru-vr-weather",
			{
				width: MENU_W_M,
				height: (MENU_W_M * MENU_TEX_H) / MENU_TEX_W,
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		this.mesh.isPickable = true;
		this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			MENU_TEX_W,
			MENU_TEX_H,
			false,
		);
		this.ui.background = "rgba(15,18,22,0.92)";
		this.section = new VrWeatherSection(initial, onAction);
		this.ui.addControl(weatherScroller(this.section, "100%"));
		this.mesh.setEnabled(false);
	}

	get visible(): boolean {
		return this.mesh.isEnabled();
	}

	showAt(position: [number, number, number]): void {
		this.mesh.position.set(...position);
		this.mesh.setEnabled(true);
	}

	hide(): void {
		this.mesh.setEnabled(false);
	}

	update(content: WeatherMenuContent): void {
		if (this.visible) this.section.update(content);
	}

	dispose(): void {
		this.ui.dispose();
		this.mesh.dispose();
	}
}
