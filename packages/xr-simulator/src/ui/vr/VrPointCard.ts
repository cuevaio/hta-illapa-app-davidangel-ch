import { Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	Button,
	Control,
	Grid,
	Image,
	StackPanel,
	TextBlock,
} from "@babylonjs/gui";
import type { VrView } from "../../xr/vrMode";
import { type IconName, iconDataUrl } from "../icons";
import type { CardAction, PointCardContent } from "../sections";

export interface VrPointCardActions {
	simulate(): void;
	cancel(): void;
	setView(view: VrView): void;
	/** Weather buttons (S8): "wx:<layer>" toggles, "wx:prev" / "wx:next" step the forecast time. */
	weather?(id: string): void;
	/** A button of the viewer's other simulators (S5), by mode id. */
	openEntry?(id: string): void;
}

const CARD_W = 0.46;
const TEX_W = 920;
/** Texture px per metre of card (the card is CARD_W wide). */
const PX_PER_M = TEX_W / CARD_W;
const TEX_H = 680;
/** Extra height of the weather section (toggles, time step, values, attribution). */
const WEATHER_TEX_H = 470;
/** Extra height of the row of the viewer's other simulators. */
const ENTRIES_TEX_H = 112;
/** VR card icons of the weather toggles (in the order of the panel). */
const WEATHER_ICONS: Record<string, IconName> = {
	"wx:clouds": "cloud",
	"wx:rain": "rain",
	"wx:lightning": "bolt",
	"wx:cape": "storm",
	"wx:wind": "wind",
	"wx:temperature": "thermo",
};
const ACCENT = "#e8913a";
const BUTTON_BG = "#2a3038";
const MUTED = "#9aa4b1";

/**
 * VR card over the Peru map (S2): the point marked with A, "Simular aquí" / "Cancelar" and the
 * Vuelo / Maqueta switch, pressed with the trigger ray (Babylon pointer selection). Same look as
 * the simulator's VrPanel. Content comes from pointCardContent (src/ui/sections.ts).
 */
export class VrPointCard {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly coords: TextBlock;
	private readonly status: TextBlock;
	private readonly buttons = new Map<
		string,
		{
			b: Button;
			img: Image;
			text: TextBlock | null;
			icon: IconName;
			src: string;
		}
	>();
	private readonly wxTime: TextBlock | null = null;
	private readonly wxValues: TextBlock | null = null;
	private readonly wxCredit: TextBlock | null = null;

	/**
	 * `weather`: adds the weather section (S8); `entries`: a row opening the viewer's other
	 * simulators (S5). Without them the card is exactly as before.
	 */
	constructor(
		scene: Scene,
		private readonly actions: VrPointCardActions,
		weather = false,
		entries: CardAction[] = [],
	) {
		const texH =
			TEX_H +
			(weather ? WEATHER_TEX_H : 0) +
			(entries.length ? ENTRIES_TEX_H : 0);
		this.mesh = MeshBuilder.CreatePlane(
			"peru-vr-card",
			{
				width: CARD_W,
				height: texH / PX_PER_M,
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		this.mesh.isPickable = true;
		// Always facing the user, whatever the map tilt in flight.
		this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			TEX_W,
			texH,
			false,
		);
		this.ui.background = "rgba(15,18,22,0.92)";
		const root = new StackPanel("card");
		root.width = "94%";
		root.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		root.paddingTop = "16px";
		this.ui.addControl(root);
		root.addControl(this.label("Punto marcado", 44, "white", true));
		this.coords = this.label("", 32, "white");
		root.addControl(this.coords);
		this.status = this.label("", 28, MUTED);
		this.status.height = "84px";
		root.addControl(this.status);
		root.addControl(
			this.row([
				{ id: "simulate", icon: "play", text: "Simular aquí" },
				{ id: "cancel", icon: "close", text: "Cancelar" },
			]),
		);
		if (entries.length) root.addControl(this.row(entries));
		root.addControl(this.label("Vista del mapa", 28, MUTED));
		root.addControl(
			this.row([
				{ id: "vuelo", icon: "fly", text: "Vuelo" },
				{ id: "maqueta", icon: "maquette", text: "Maqueta" },
			]),
		);
		if (weather) {
			root.addControl(this.label("Capas meteorológicas", 28, MUTED));
			const toggles = new Grid();
			toggles.height = "96px";
			const ids = Object.keys(WEATHER_ICONS);
			ids.forEach(() => {
				toggles.addColumnDefinition(1 / ids.length);
			});
			ids.forEach((id, k) => {
				toggles.addControl(this.iconButton(id, WEATHER_ICONS[id]), 0, k);
			});
			root.addControl(toggles);
			const time = new Grid();
			time.height = "96px";
			time.addColumnDefinition(0.2);
			time.addColumnDefinition(0.6);
			time.addColumnDefinition(0.2);
			time.addControl(this.iconButton("wx:prev", "stepBack"), 0, 0);
			this.wxTime = this.label("", 26, "white");
			this.wxTime.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
			this.wxTime.height = "96px";
			time.addControl(this.wxTime, 0, 1);
			time.addControl(this.iconButton("wx:next", "stepForward"), 0, 2);
			root.addControl(time);
			this.wxValues = this.label("", 24, "white");
			this.wxValues.height = "170px";
			this.wxValues.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
			root.addControl(this.wxValues);
			this.wxCredit = this.label("", 20, MUTED);
			this.wxCredit.height = "60px";
			root.addControl(this.wxCredit);
		}
		this.mesh.setEnabled(false);
	}

	get visible(): boolean {
		return this.mesh.isEnabled();
	}

	/** Shows the card at a world position (it turns to face the camera by itself). */
	showAt(position: [number, number, number]): void {
		this.mesh.position.set(...position);
		this.mesh.setEnabled(true);
	}

	hide(): void {
		this.mesh.setEnabled(false);
	}

	update(c: PointCardContent): void {
		this.coords.text = c.coords;
		this.status.text = c.status ?? "";
		// Downloading (both actions off): accent; a failure: warning yellow.
		this.status.color = !c.simulate && !c.cancel ? ACCENT : "#ffcf70";
		this.sync("simulate", false, !c.simulate);
		this.sync("cancel", false, !c.cancel);
		for (const v of c.views) this.sync(v.id, v.active, false);
		for (const e of c.entries) this.sync(e.id, false, !e.enabled);
		const w = c.weather;
		if (!w || !this.wxValues) return;
		for (const t of w.toggles) this.sync(t.id, t.active, t.disabled);
		this.sync("wx:prev", false, !w.time);
		this.sync("wx:next", false, !w.time);
		this.wxTime!.text = w.time ?? "Sin pronóstico";
		this.wxValues.text = w.values.length
			? w.values.join("\n")
			: "Activa una capa para ver sus valores en el punto.";
		this.wxCredit!.text = w.credit ? `Datos: ${w.credit}` : "";
	}

	private sync(id: string, active: boolean, disabled: boolean): void {
		const e = this.buttons.get(id);
		if (!e) return;
		const color = active ? "#111111" : "#ffffff";
		e.b.background = active ? ACCENT : BUTTON_BG;
		if (e.text) e.text.color = color;
		const src = iconDataUrl(e.icon, color);
		if (src !== e.src) {
			e.img.source = src;
			e.src = src;
		}
		e.b.isEnabled = !disabled;
		e.b.alpha = disabled ? 0.35 : 1;
	}

	private label(
		text: string,
		size: number,
		color: string,
		bold = false,
	): TextBlock {
		const t = new TextBlock(undefined, text);
		t.color = color;
		t.fontSize = size;
		t.fontWeight = bold ? "bold" : "normal";
		t.height = `${Math.round(size * 1.6)}px`;
		t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		t.textWrapping = true;
		return t;
	}

	private row(items: CardAction[]): Grid {
		const grid = new Grid();
		grid.height = "112px";
		items.forEach(() => {
			grid.addColumnDefinition(1 / items.length);
		});
		items.forEach((it, k) => {
			grid.addControl(this.button(it), 0, k);
		});
		return grid;
	}

	private button(it: CardAction): Button {
		const b = new Button();
		b.background = BUTTON_BG;
		b.cornerRadius = 14;
		b.thickness = 0;
		b.paddingLeft = b.paddingRight = "6px";
		b.paddingTop = b.paddingBottom = "8px";
		const content = new Grid();
		const ICON = 56;
		content.addColumnDefinition(ICON + 20, true);
		content.addColumnDefinition(1);
		const img = new Image();
		img.width = `${ICON}px`;
		img.height = `${ICON}px`;
		img.stretch = Image.STRETCH_UNIFORM;
		img.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
		content.addControl(img, 0, 0);
		const text = new TextBlock(undefined, it.text);
		text.fontSize = 32;
		text.color = "white";
		text.paddingLeft = "12px";
		text.paddingRight = "8px";
		text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		text.textWrapping = 2; // TextWrapping.Ellipsis (ambient const enum)
		content.addControl(text, 0, 1);
		b.addControl(content);
		b.onPointerClickObservable.add(() => {
			if (!b.isEnabled) return;
			if (it.id === "simulate") this.actions.simulate();
			else if (it.id === "cancel") this.actions.cancel();
			else if (it.id.startsWith("mode:"))
				this.actions.openEntry?.(it.id.slice("mode:".length));
			else this.actions.setView(it.id as VrView);
		});
		this.buttons.set(it.id, { b, img, text, icon: it.icon, src: "" });
		this.sync(it.id, false, false);
		return b;
	}

	/** Icon-only button (weather toggles and the time step). */
	private iconButton(id: string, icon: IconName): Button {
		const b = new Button();
		b.background = BUTTON_BG;
		b.cornerRadius = 14;
		b.thickness = 0;
		b.paddingLeft = b.paddingRight = "6px";
		b.paddingTop = b.paddingBottom = "8px";
		const img = new Image();
		img.width = "52px";
		img.height = "52px";
		img.stretch = Image.STRETCH_UNIFORM;
		b.addControl(img);
		b.onPointerClickObservable.add(() => {
			if (b.isEnabled) this.actions.weather?.(id);
		});
		this.buttons.set(id, { b, img, text: null, icon, src: "" });
		this.sync(id, false, false);
		return b;
	}

	dispose(): void {
		this.ui.dispose();
		this.mesh.dispose();
	}
}
