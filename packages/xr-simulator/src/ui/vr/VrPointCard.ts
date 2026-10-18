import { Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import type { VrView } from "../../xr/vrMode";
import type { CardAction, PointCardContent } from "../sections";
import { metresOf, readVrTheme, texturePx } from "./theme";
import {
	type MayuControl,
	type MayuControlKind,
	MayuText,
	mayuCard,
	mayuControl,
	mayuLabel,
	mayuRow,
} from "./themeGui";

export interface VrPointCardActions {
	simulate(): void;
	cancel(): void;
	setView(view: VrView): void;
	/** A button of the viewer's other simulators (S5), by mode id. */
	openEntry?(id: string): void;
}

/** Card size in web CSS px; the texture is the tallest it can be, the card hugs its content. */
const CARD_CSS_W = 320;
const CARD_CSS_H = 340;
/** Extra height for the row of the viewer's other simulators. */
const ENTRIES_CSS_H = 44;

/**
 * VR card over the Peru map (S2): the point marked with A, "Simular aquí" / "Cancelar" and the
 * Vuelo / Maqueta switch, pressed with the trigger ray. A web Card (S12); content comes from
 * pointCardContent (src/ui/sections.ts).
 */
export class VrPointCard {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly theme = readVrTheme();
	private readonly coords: MayuText;
	private readonly status: MayuText;
	private readonly controls = new Map<string, MayuControl>();

	/**
	 * `entries`: a row opening the viewer's other simulators (S5). Without them the card is
	 * exactly as before.
	 */
	constructor(
		scene: Scene,
		private readonly actions: VrPointCardActions,
		entries: CardAction[] = [],
	) {
		const heightCssPx = CARD_CSS_H + (entries.length ? ENTRIES_CSS_H : 0);
		this.mesh = MeshBuilder.CreatePlane(
			"peru-vr-card",
			{
				width: metresOf(CARD_CSS_W),
				height: metresOf(heightCssPx),
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		this.mesh.isPickable = true;
		// Always facing the user, wherever they fly.
		this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			texturePx(CARD_CSS_W),
			texturePx(heightCssPx),
			false,
		);
		const card = mayuCard(this.ui, this.theme, { title: "Punto marcado" });
		this.coords = new MayuText(this.theme, "data");
		card.content.addControl(this.coords);
		this.status = new MayuText(this.theme, "body");
		card.content.addControl(this.status);
		card.content.addControl(
			this.row([
				// The card's one primary action.
				[
					{ id: "simulate", icon: "play", text: "Simular aquí" },
					{ kind: "button", variant: "default" },
				],
				[
					{ id: "cancel", icon: "close", text: "Cancelar" },
					{ kind: "button", variant: "outline" },
				],
			]),
		);
		if (entries.length)
			card.content.addControl(
				this.row(
					entries.map((entry) => [
						entry,
						{ kind: "button", variant: "secondary" },
					]),
				),
			);
		card.content.addControl(mayuLabel(this.theme, "Vista del mapa"));
		card.content.addControl(
			this.row([
				[{ id: "vuelo", icon: "fly", text: "Vuelo" }, { kind: "toggle" }],
				[
					{ id: "maqueta", icon: "maquette", text: "Maqueta" },
					{ kind: "toggle" },
				],
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
		this.coords.show(c.coords);
		this.status.show(c.status ?? "");
		this.status.isVisible = c.status !== null;
		// Downloading (both actions off): the muted ink; a failure: the destructive colour.
		this.status.color =
			!c.simulate && !c.cancel
				? this.theme.colors.mutedForeground
				: this.theme.colors.destructive;
		this.controls.get("simulate")?.set({ disabled: !c.simulate });
		this.controls.get("cancel")?.set({ disabled: !c.cancel });
		for (const v of c.views) this.controls.get(v.id)?.set({ on: v.active });
		for (const e of c.entries)
			this.controls.get(e.id)?.set({ disabled: !e.enabled });
	}

	private row(items: [CardAction, MayuControlKind][]) {
		return mayuRow(
			items.map(([action, kind]) => {
				const control = mayuControl(
					this.theme,
					kind,
					{ icon: action.icon, text: action.text },
					() => this.press(action.id),
				);
				this.controls.set(action.id, control);
				return control.button;
			}),
		);
	}

	private press(id: string): void {
		if (id === "simulate") this.actions.simulate();
		else if (id === "cancel") this.actions.cancel();
		else if (id.startsWith("mode:"))
			this.actions.openEntry?.(id.slice("mode:".length));
		else if (id === "vuelo" || id === "maqueta") this.actions.setView(id);
	}

	dispose(): void {
		this.ui.dispose();
		this.mesh.dispose();
	}
}
