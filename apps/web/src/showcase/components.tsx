import { Separator } from "@hack-the-andes-project/ui/components/separator";
import { ShowcaseSection } from "@hack-the-andes-project/ui/components/showcase/section";
import { ShowcaseTier } from "@hack-the-andes-project/ui/components/showcase/tier";
import { StructureArt } from "@hack-the-andes-project/ui/components/structure-art";
import type { ComponentProps } from "react";
import { m } from "@/paraglide/messages";
import { ActionsShowcase } from "./components/actions";
import { ConversationShowcase } from "./components/conversation";
import { DataDisplayShowcase } from "./components/data-display";
import { FeedbackShowcase } from "./components/feedback";
import { InputsShowcase } from "./components/inputs";
import { NavigationShowcase } from "./components/navigation";
import { OverlaysShowcase } from "./components/overlays";

interface StructureArtExample {
	kind: ComponentProps<typeof StructureArt>["kind"];
	label: string;
}

const structureArtExamples: readonly StructureArtExample[] = [
	{ kind: "bridge", label: "Puente" },
	{ kind: "tunnel", label: "Túnel" },
	{ kind: "bypass", label: "Variante" },
	{ kind: "block", label: "Bloque" },
	{ kind: "column", label: "Columna" },
	{ kind: "beam", label: "Viga" },
	{ kind: "slab", label: "Losa" },
	{ kind: "wall", label: "Muro" },
];

export function ComponentsSection() {
	return (
		<ShowcaseSection
			id="componentes"
			number="04"
			kicker={m.ds_section_kicker()}
			title={m.ds_components_title()}
			description={m.ds_components_description()}
		>
			<div className="flex min-w-0 flex-col gap-12">
				<ShowcaseTier
					id="components-structure-art"
					title="Structure art"
					description="Plantillas y piezas para construir sobre el terreno. Ilustraciones isométricas en ambos tamaños de la paleta."
				>
					<div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
						{structureArtExamples.map((structureExample) => (
							<figure
								key={structureExample.kind}
								className="flex flex-col gap-4 rounded-lg border bg-card p-4"
							>
								<figcaption className="type-label">
									{structureExample.label}
								</figcaption>
								<div className="flex items-end justify-around gap-4">
									{[
										{ className: "size-12", label: "48 px" },
										{ className: "size-24", label: "96 px" },
									].map((artSize) => (
										<div
											key={artSize.label}
											className="flex flex-col items-center gap-2"
										>
											<StructureArt
												kind={structureExample.kind}
												label={structureExample.label}
												className={artSize.className}
											/>
											<span className="type-data text-muted-foreground">
												{artSize.label}
											</span>
										</div>
									))}
								</div>
							</figure>
						))}
					</div>
				</ShowcaseTier>
				<Separator />
				<ActionsShowcase />
				<Separator />
				<InputsShowcase />
				<Separator />
				<NavigationShowcase />
				<Separator />
				<DataDisplayShowcase />
				<Separator />
				<FeedbackShowcase />
				<Separator />
				<OverlaysShowcase />
				<Separator />
				<ConversationShowcase />
			</div>
		</ShowcaseSection>
	);
}
