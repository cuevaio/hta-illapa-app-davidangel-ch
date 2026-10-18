// CLI of tools/tiles-types.ts: rewrites packages/tiles-schema/types.ts. Usage: pnpm --filter @hack-the-andes-project/xr-simulator schema:types
import { readFile, writeFile } from "node:fs/promises";
import {
	generateTypes,
	SCHEMA_DIR,
	type SchemaFiles,
	TYPES_FILE,
} from "./tiles-types";

async function readSchemaFiles(dir = SCHEMA_DIR): Promise<SchemaFiles> {
	const read = async (f: string) =>
		JSON.parse(await readFile(`${dir}/${f}`, "utf8")) as Record<
			string,
			unknown
		>;
	return {
		capas: await read("capas.schema.json"),
		tileMetadata: await read("tile-metadata.schema.json"),
		openapi: await read("openapi.json"),
	};
}

export async function main(): Promise<number> {
	await writeFile(TYPES_FILE, generateTypes(await readSchemaFiles()));
	console.log(`Wrote ${TYPES_FILE}`);
	return 0;
}
