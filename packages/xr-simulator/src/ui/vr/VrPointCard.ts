import { Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	type Button,
	Control,
	Grid,
	Image,
	StackPanel,
	type TextBlock,
} from "@babylonjs/gui";
import type { VrView } from "../../xr/vrMode";
import type { IconName } from "../icons";
import type { CardAction, PointCardContent } from "../sections";
import { readVrTheme } from "./theme";
import {
	paintButton,
	themedButton,
	themedSurface,
	themedText,
} from "./themeGui";

export interface VrPointCardActions {
	simulate(): void;
	cancel(): void;
	setView(view: VrView): void;
	/** A button of the viewer's other simulators (S5), by mode id. */
	openEntry?(id: string): void;
}

const CARD_W = 0.46;
const TEX_W = 920;
/** Texture px per metre of card (the card is CARD_W wide). */
const PX_PER_M = TEX_W / CARD_W;
const TEX_H = 680;
const BUTTON_TEXT_PX = 30;
/** Extra height of the row of the viewer's other simulators. */
const ENTRIES_TEX_H = 112;

/**
 * VR card over the Peru map (S2): the point marked with A, "Simular aquí" / "Cancelar" and the
 * Vuelo / Maqueta switch, pressed with the trigger ray (Babylon pointer selection). Same look as
 * the simulator's VrPanel. Content comes from pointCardContent (src/ui/sections.ts).
 */
export class VrPointCard {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly theme = readVrTheme();
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

	/**
	 * `entries`: a row opening the viewer's other simulators (S5). Without them the card is
	 * exactly as before.
	 */
	constructor(
		scene: Scene,
		private readonly actions: VrPointCardActions,
		entries: CardAction[] = [],
	) {
		const texH = TEX_H + (entries.length ? ENTRIES_TEX_H : 0);
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
		// Always facing the user, wherever they fly.
		this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			TEX_W,
			texH,
			false,
		);
		themedSurface(this.ui, this.theme);
		const root = new StackPanel("card");
		root.width = "94%";
		root.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		root.paddingTop = "16px";
		this.ui.addControl(root);
		root.addControl(themedText(this.theme, "heading", "Punto marcado"));
		this.coords = themedText(this.theme, "data");
		root.addControl(this.coords);
		this.status = themedText(this.theme, "body");
		this.status.height = "84px";
		root.addControl(this.status);
		root.addControl(
			this.row([
				{ id: "simulate", icon: "play", text: "Simular aquí" },
				{ id: "cancel", icon: "close", text: "Cancelar" },
			]),
		);
		if (entries.length) root.addControl(this.row(entries));
		root.addControl(themedText(this.theme, "label", "Vista del mapa"));
		root.addControl(
			this.row([
				{ id: "vuelo", icon: "fly", text: "Vuelo" },
				{ id: "maqueta", icon: "maquette", text: "Maqueta" },
			]),
		);
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
		// Downloading (both actions off): the action colour; a failure: the error colour.
		this.status.color =
			!c.simulate && !c.cancel ? this.theme.action : this.theme.error;
		// "Simular aquí" is the card's one primary action.
		this.sync("simulate", true, !c.simulate);
		this.sync("cancel", false, !c.cancel);
		for (const v of c.views) this.sync(v.id, v.active, false);
		for (const e of c.entries) this.sync(e.id, false, !e.enabled);
	}

	private sync(id: string, active: boolean, disabled: boolean): void {
		const e = this.buttons.get(id);
		if (!e) return;
		e.src = paintButton(
			this.theme,
			{ button: e.b, label: e.text, image: e.img, icon: e.icon, source: e.src },
			{ active, disabled },
		);
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
		const b = themedButton(this.theme);
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
		const text = themedText(this.theme, "button", it.text, BUTTON_TEXT_PX);
		text.height = "100%";
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
		this.sync(it.id, it.id === "simulate", false);
		return b;
	}

	dispose(): void {
		this.ui.dispose();
		this.mesh.dispose();
	}
}
