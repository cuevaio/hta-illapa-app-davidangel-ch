import type {
	NumericRange,
	StructureKind,
	StructurePrimitiveKind,
} from "@hack-the-andes-project/business/structures/catalog";
import { parseStructureNumber } from "@hack-the-andes-project/business/structures/parameters";
import { MinusIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { TransformMode } from "../lib/structure-scene";
import { Button } from "./button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./field";
import { Input } from "./input";
import { NativeSelect, NativeSelectOption } from "./native-select";
import { Separator } from "./separator";
import { StructureArt } from "./structure-art";
import type { StructureEditorLabels } from "./structure-editor-labels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Textarea } from "./textarea";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

export interface StructureEditorOption {
	value: string;
	label: string;
}

export interface StructureEditorField {
	id: string;
	label: string;
	value: string;
	numericRange?: Pick<NumericRange, "min" | "max" | "step">;
	unit?: string;
	options?: StructureEditorOption[];
	multiline?: boolean;
	placeholder?: string;
	readOnly?: boolean;
	required?: boolean;
	maxLength?: number;
	onCommit?: (value: string) => void;
}

export function StructureEditorParameterInput({
	field,
	locale,
}: {
	field: StructureEditorField;
	locale: string;
}) {
	const inputId = useId();
	const [draft, setDraft] = useState(field.value);
	const focused = useRef(false);
	useEffect(() => {
		if (!focused.current) setDraft(field.value);
	}, [field.value]);
	const commit = (value: string) => {
		const numeric = parseStructureNumber(value, locale);
		const fractionDigits =
			String(field.numericRange?.step).split(".")[1]?.length ?? 0;
		const committed = field.numericRange
			? String(
					Number.isFinite(numeric) && value !== ""
						? Number(
								Math.min(
									field.numericRange.max,
									Math.max(field.numericRange.min, numeric),
								).toFixed(fractionDigits),
							)
						: Number(field.value),
				)
			: field.required && !value
				? field.value
				: value;
		setDraft(committed);
		field.onCommit?.(committed);
	};
	return (
		<Field>
			<FieldLabel htmlFor={inputId}>{field.label}</FieldLabel>
			{field.options ? (
				<NativeSelect
					id={inputId}
					value={field.value}
					className="w-full"
					onChange={(event) => field.onCommit?.(event.target.value)}
				>
					{field.options.map((option) => (
						<NativeSelectOption key={option.value} value={option.value}>
							{option.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			) : field.multiline ? (
				<Textarea
					id={inputId}
					value={draft}
					maxLength={field.maxLength}
					placeholder={field.placeholder}
					onFocus={() => {
						focused.current = true;
					}}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={() => {
						focused.current = false;
						commit(draft);
					}}
				/>
			) : (
				<div className="flex items-center gap-1">
					{field.numericRange && (
						<Button
							size="icon-sm"
							variant="outline"
							aria-label={`${field.label} −`}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() =>
								commit(
									String(
										parseStructureNumber(draft || field.value, locale) -
											(field.numericRange?.step ?? 0),
									),
								)
							}
						>
							<MinusIcon />
						</Button>
					)}
					<Input
						id={inputId}
						value={draft}
						readOnly={field.readOnly}
						required={field.required}
						maxLength={field.maxLength}
						inputMode={field.numericRange ? "decimal" : undefined}
						aria-describedby={
							field.numericRange ? `${inputId}-range` : undefined
						}
						onFocus={() => {
							focused.current = true;
						}}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={() => {
							focused.current = false;
							commit(draft);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								event.currentTarget.blur();
							}
						}}
					/>
					{field.unit && (
						<span className="type-data text-muted-foreground">
							{field.unit}
						</span>
					)}
					{field.numericRange && (
						<Button
							size="icon-sm"
							variant="outline"
							aria-label={`${field.label} +`}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() =>
								commit(
									String(
										parseStructureNumber(draft || field.value, locale) +
											(field.numericRange?.step ?? 0),
									),
								)
							}
						>
							<PlusIcon />
						</Button>
					)}
				</div>
			)}
			{field.numericRange && (
				<FieldDescription id={`${inputId}-range`}>
					{field.numericRange.min}–{field.numericRange.max} {field.unit}
				</FieldDescription>
			)}
		</Field>
	);
}

export interface StructureEditorElementRow {
	id: string;
	name: string;
	material: string;
	deleteLabel: string;
}

interface StructureEditorParametersProps {
	kind: StructureKind;
	primitiveKind?: StructurePrimitiveKind;
	name: string;
	subtitle: string;
	labels: StructureEditorLabels;
	fields: StructureEditorField[];
	elements: StructureEditorElementRow[];
	elementName: string | null;
	transformMode: TransformMode;
	exposure: ReactNode;
	exposureCount: number;
	activePanelTab: string;
	widthPx: number;
	locale: string;
	deleteLabel: string;
	onTabChange: (activePanelTab: string) => void;
	onClose: () => void;
	onReleaseElement: () => void;
	onSelectElement: (id: string) => void;
	onDeleteElement: (id: string) => void;
	onTransformMode: (mode: TransformMode) => void;
	onDelete: () => void;
}

export function StructureEditorParameters({
	kind,
	primitiveKind,
	name,
	subtitle,
	labels,
	fields,
	elements,
	elementName,
	transformMode,
	exposure,
	exposureCount,
	activePanelTab,
	widthPx,
	locale,
	deleteLabel,
	onTabChange,
	onClose,
	onReleaseElement,
	onSelectElement,
	onDeleteElement,
	onTransformMode,
	onDelete,
}: StructureEditorParametersProps) {
	return (
		<aside
			className="pointer-events-auto flex min-h-0 shrink-0 flex-col rounded-lg border bg-card"
			style={{ width: widthPx }}
			aria-label={name}
		>
			<div className="flex items-start gap-2 p-4">
				<StructureArt
					kind={kind === "entity" ? (primitiveKind ?? "block") : kind}
					className="size-8"
				/>
				<div className="min-w-0 flex-1">
					<h2 className="type-heading truncate">{name}</h2>
					<p className="text-muted-foreground text-xs">{subtitle}</p>
				</div>
				<Button
					size="icon-sm"
					variant="ghost"
					onClick={onClose}
					aria-label={labels.close}
				>
					<XIcon />
				</Button>
			</div>
			<Tabs
				value={activePanelTab}
				onValueChange={onTabChange}
				className="flex min-h-0 flex-1 flex-col gap-0"
			>
				<TabsList className="mx-3 grid w-auto grid-cols-2">
					<TabsTrigger value="parameters" className="type-label">
						{labels.parameters}
					</TabsTrigger>
					<TabsTrigger value="exposure" className="type-label">
						{labels.exposure} · {exposureCount}
					</TabsTrigger>
				</TabsList>
				<TabsContent
					value="parameters"
					className="min-h-0 flex-1 overflow-y-auto p-4"
				>
					{elementName && (
						<div className="mb-4 flex flex-col gap-3">
							<Button
								variant="link"
								className="justify-start px-0"
								onClick={onReleaseElement}
							>
								{name} › {elementName}
							</Button>
							<ToggleGroup
								value={[transformMode]}
								onValueChange={(values) => {
									const mode = values[0];
									if (
										mode === "translate" ||
										mode === "rotate" ||
										mode === "scale"
									)
										onTransformMode(mode);
								}}
								variant="outline"
								aria-label={labels.parameters}
							>
								<ToggleGroupItem value="translate">
									{labels.translate}
								</ToggleGroupItem>
								<ToggleGroupItem value="rotate">
									{labels.rotate}
								</ToggleGroupItem>
								<ToggleGroupItem value="scale">{labels.scale}</ToggleGroupItem>
							</ToggleGroup>
						</div>
					)}
					<FieldGroup>
						{fields.map((field) => (
							<StructureEditorParameterInput
								key={field.id}
								field={field}
								locale={locale}
							/>
						))}
					</FieldGroup>
					{!elementName && (
						<section className="mt-5 flex flex-col gap-2">
							<Separator />
							<h3 className="type-label py-2">
								{labels.elements} · {elements.length}
							</h3>
							{elements.map((structureElement) => (
								<div
									key={structureElement.id}
									className="flex items-center gap-1"
								>
									<Button
										variant="ghost"
										className="min-w-0 flex-1 justify-start"
										onClick={() => onSelectElement(structureElement.id)}
									>
										<span className="truncate">{structureElement.name}</span>
										<span className="text-muted-foreground">
											{structureElement.material}
										</span>
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={structureElement.deleteLabel}
										onClick={() => onDeleteElement(structureElement.id)}
									>
										<Trash2Icon />
									</Button>
								</div>
							))}
						</section>
					)}
				</TabsContent>
				<TabsContent
					value="exposure"
					className="min-h-0 flex-1 overflow-y-auto p-4"
				>
					{exposure}
				</TabsContent>
			</Tabs>
			<Separator />
			<div className="p-3">
				<Button variant="outline" className="w-full" onClick={onDelete}>
					<Trash2Icon data-icon="inline-start" />
					{deleteLabel}
				</Button>
			</div>
		</aside>
	);
}
