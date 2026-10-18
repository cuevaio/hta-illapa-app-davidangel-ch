import { Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	Control,
	Grid,
	type Rectangle,
	ScrollViewer,
	StackPanel,
} from "@babylonjs/gui";
import type { WeatherMenuContent } from "../sections";
import {
	BUTTON_HEIGHT_CSS_PX,
	CONTROL_GAP_CSS_PX,
	metresOf,
	readVrTheme,
	texturePx,
	type VrTheme,
} from "./theme";
import {
	type MayuControl,
	MayuText,
	mayuBadge,
	mayuCard,
	mayuControl,
	mayuLabel,
	mayuRow,
} from "./themeGui";

/** The standalone menu over the Peru map, in web CSS px. */
const MENU_CSS_W = 400;
const MENU_CSS_H = 840;
/** Its scrolling content: the menu minus the card header, the footer and spacing. */
const MENU_SCROLL_CSS_H = 660;
/** The scroll bar, wide enough to drag with the controller ray. */
const SCROLL_BAR_CSS_PX = 12;
/** One layer row: toggle, badge, opacity − / value / + (fractions of the row). */
const LAYER_COLUMNS = [0.47, 0.26, 0.08, 0.11, 0.08];

/**
 * "Capas meteorológicas" in VR (S8): every option of the web weather panel (layer toggles with
 * their badge, opacity, forecast timeline with play, precipitation scale, legends, provenance,
 * point values and attribution), pressed with the controller ray. Built into any card content:
 * the huayco VR panel shows it as a page, the Peru map as its own card (VrWeatherMenu).
 */
export class VrWeatherSection {
	readonly root = new StackPanel("weather-section");
	private readonly controls = new Map<string, MayuControl>();
	private readonly opacity = new Map<
		string,
		{ cells: Control[]; value: MayuText }
	>();
	private readonly notice: MayuText;
	private readonly status: MayuText;
	private readonly timeBox = new StackPanel("weather-time");
	private readonly timeLabel: MayuText;
	private readonly rainBox = new StackPanel("weather-rain");
	private readonly legends: MayuText;
	private readonly values: MayuText;
	private readonly provenance: MayuText;
	private readonly credit: MayuText;
	private shownKey = "";

	constructor(
		private readonly theme: VrTheme,
		initial: WeatherMenuContent,
		private readonly onAction: (id: string) => void,
	) {
		const gap = texturePx(CONTROL_GAP_CSS_PX);
		this.root.width = "100%";
		this.root.spacing = gap;
		this.notice = new MayuText(theme, "body");
		this.notice.color = theme.colors.destructive;
		this.root.addControl(this.notice);
		this.root.addControl(mayuLabel(theme, "Capas"));
		for (const layer of initial.layers) {
			const row = new Grid("weather-layer");
			row.height = `${texturePx(BUTTON_HEIGHT_CSS_PX)}px`;
			for (const fraction of LAYER_COLUMNS) row.addColumnDefinition(fraction);
			const layerId = layer.id.slice("wx:".length);
			row.addControl(
				this.control(layer.id, { kind: "toggle" }, layer.icon, layer.text),
				0,
				0,
			);
			const badge: Rectangle = mayuBadge(theme, "secondary", layer.badge);
			badge.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
			row.addControl(badge, 0, 1);
			const down = this.control(
				`wx:opacity-down:${layerId}`,
				{ kind: "button", variant: "outline" },
				null,
				"−",
			);
			const value = new MayuText(theme, "data");
			value.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
			value.height = "100%";
			const up = this.control(
				`wx:opacity-up:${layerId}`,
				{ kind: "button", variant: "outline" },
				null,
				"+",
			);
			down.paddingLeft = `${gap / 2}px`;
			up.paddingLeft = `${gap / 2}px`;
			row.addControl(down, 0, 2);
			row.addControl(value, 0, 3);
			row.addControl(up, 0, 4);
			this.opacity.set(layer.id, { cells: [down, value, up], value });
			this.root.addControl(row);
		}
		this.status = new MayuText(theme, "body");
		this.status.color = theme.colors.mutedForeground;
		this.root.addControl(this.status);

		this.timeBox.width = "100%";
		this.timeBox.spacing = gap;
		this.timeBox.addControl(mayuLabel(theme, "Pronóstico"));
		this.timeBox.addControl(
			mayuRow([
				this.control(
					"wx:prev",
					{ kind: "button", variant: "outline" },
					"stepBack",
					"",
				),
				this.control("wx:play", { kind: "toggle" }, "play", "Reproducir"),
				this.control(
					"wx:next",
					{ kind: "button", variant: "outline" },
					"stepForward",
					"",
				),
			]),
		);
		this.timeLabel = new MayuText(theme, "data");
		this.timeBox.addControl(this.timeLabel);
		this.root.addControl(this.timeBox);

		this.rainBox.width = "100%";
		this.rainBox.spacing = gap;
		this.rainBox.addControl(mayuLabel(theme, "Precipitación"));
		this.rainBox.addControl(
			mayuRow(
				(["rate", "accum"] as const).map((mode) =>
					this.control(`wx:rain:${mode}`, { kind: "toggle" }, "rain", mode),
				),
			),
		);
		this.root.addControl(this.rainBox);

		this.legends = new MayuText(theme, "body");
		this.values = new MayuText(theme, "data");
		this.provenance = new MayuText(theme, "body");
		this.provenance.color = theme.colors.mutedForeground;
		this.credit = new MayuText(theme, "body");
		this.credit.color = theme.colors.mutedForeground;
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
			this.controls
				.get(layer.id)
				?.set({ on: layer.active, disabled: layer.disabled });
			const opacity = this.opacity.get(layer.id);
			if (!opacity) continue;
			for (const cell of opacity.cells) cell.isVisible = layer.opacity !== null;
			opacity.value.show(layer.opacity ?? "");
		}
		this.setText(this.status, content.status.join("\n") || null);
		this.timeBox.isVisible = content.time !== null;
		if (content.time) {
			this.timeLabel.show(content.time.label);
			const play = this.controls.get("wx:play");
			play?.setText(content.time.playing ? "Pausa" : "Reproducir");
			play?.setIcon(content.time.playing ? "pause" : "play");
			play?.set({ on: content.time.playing });
		}
		this.rainBox.isVisible = content.rain !== null;
		for (const option of content.rain ?? []) {
			const control = this.controls.get(option.id);
			control?.setText(option.text);
			control?.set({ on: option.active });
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

	private setText(block: MayuText, text: string | null): void {
		block.show(text ?? "");
		block.isVisible = text !== null;
	}

	private control(
		id: string,
		kind: Parameters<typeof mayuControl>[1],
		icon: Parameters<typeof mayuControl>[2]["icon"],
		text: string,
	): Control {
		const control = mayuControl(this.theme, kind, { icon, text }, () =>
			this.onAction(id),
		);
		this.controls.set(id, control);
		return control.button;
	}
}

/**
 * The section in a scroller: with every layer on, its legends and provenance outgrow any card
 * that still fits the field of view.
 */
export function weatherScroller(
	theme: VrTheme,
	section: VrWeatherSection,
	height: string,
): ScrollViewer {
	const scroller = new ScrollViewer("weather-scroll");
	scroller.width = "100%";
	scroller.height = height;
	scroller.thickness = 0;
	scroller.barSize = texturePx(SCROLL_BAR_CSS_PX);
	scroller.barColor = theme.colors.border;
	scroller.barBackground = "transparent";
	scroller.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	section.root.paddingRight = `${texturePx(SCROLL_BAR_CSS_PX + CONTROL_GAP_CSS_PX)}px`;
	scroller.addControl(section.root);
	return scroller;
}

/**
 * The weather menu over the Peru map in VR: its own floating card, toggled with X (S8), with
 * «Controles» in its footer to reopen the controls instructions (S15).
 */
export class VrWeatherMenu {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly section: VrWeatherSection;

	constructor(
		scene: Scene,
		initial: WeatherMenuContent,
		onAction: (id: string) => void,
		onControls: () => void,
	) {
		this.mesh = MeshBuilder.CreatePlane(
			"peru-vr-weather",
			{
				width: metresOf(MENU_CSS_W),
				height: metresOf(MENU_CSS_H),
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		this.mesh.isPickable = true;
		this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			texturePx(MENU_CSS_W),
			texturePx(MENU_CSS_H),
			false,
		);
		const theme = readVrTheme();
		const card = mayuCard(this.ui, theme, {
			title: "Capas meteorológicas",
			footer: true,
		});
		this.section = new VrWeatherSection(theme, initial, onAction);
		card.content.addControl(
			weatherScroller(theme, this.section, `${texturePx(MENU_SCROLL_CSS_H)}px`),
		);
		card.footer?.addControl(
			mayuRow([
				mayuControl(
					theme,
					{ kind: "button", variant: "outline" },
					{ icon: "help", text: "Controles" },
					onControls,
				).button,
			]),
		);
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
