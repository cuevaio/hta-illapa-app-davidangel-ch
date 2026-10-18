import { vi } from "vitest";
import type { StructureSceneProps } from "../../../lib/structure-scene";
import { TEST_STRUCTURE } from "./constants";

export function createTestProps(): StructureSceneProps {
	return {
		origin: TEST_STRUCTURE.anchor,
		structures: [TEST_STRUCTURE],
		selectedStructureId: TEST_STRUCTURE.id,
		selectedElementId: null,
		hoveredStructureId: null,
		placementTool: null,
		primitiveTarget: "selection",
		transformMode: "translate",
		cameraRequest: null,
		exposureRing: null,
		incidentMarkers: [],
		landmarks: [],
		insets: { topPx: 0, rightPx: 0, bottomPx: 0, leftPx: 0 },
		locale: "es-PE",
		xrRequest: null,
		labels: {
			canvas: "Terreno PE-22",
			outsideTerrain: "Fuera del terreno",
			terrainError: "Error de terreno",
			span: "Luz",
			heightDifference: "Desnivel",
			length: "Longitud",
			slope: "Pendiente",
			abutment: "Estribo",
			portal: "Portal",
			point: "Punto",
			placeTable: "Colocar maqueta",
			undo: "Deshacer",
			exitXr: "Salir de AR",
		},
		onCreateStructure: vi.fn(),
		onStructureChange: vi.fn(),
		onSelectStructure: vi.fn(),
		onSelectElement: vi.fn(),
		onCursorChange: vi.fn(),
		onUndo: vi.fn(),
		onTerrainStatusChange: vi.fn(),
		onXrSupportChange: vi.fn(),
		onXrSessionChange: vi.fn(),
	};
}
