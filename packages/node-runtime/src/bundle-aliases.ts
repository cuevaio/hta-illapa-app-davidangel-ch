import { fileURLToPath } from "node:url";

// Modules the Node bundles swap for their Node implementation. The trailing
// `$` aliases the bare db import only, so its schema subpaths resolve as usual.
// Node loads this file natively from the tsdown configs, so it must not import
// its siblings without a file extension.
export const NODE_BUNDLE_ALIASES = {
	"cloudflare:workers": fileURLToPath(
		import.meta.resolve("./cloudflare-workers.ts"),
	),
	"evlog/workers": fileURLToPath(import.meta.resolve("./evlog-workers.ts")),
	"@hack-the-andes-project/db$": fileURLToPath(import.meta.resolve("./db.ts")),
};
