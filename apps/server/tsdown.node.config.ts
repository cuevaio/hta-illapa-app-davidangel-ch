import { NODE_BUNDLE_ALIASES } from "@hack-the-andes-project/node-runtime/bundle-aliases";
import { defineConfig } from "tsdown";

export default defineConfig({
	entry: "./src/node.ts",
	platform: "node",
	format: "esm",
	outDir: "./dist-node",
	clean: true,
	alias: NODE_BUNDLE_ALIASES,
	copy: "../../packages/db/src/migrations",
	deps: {
		alwaysBundle: [/.*/],
		onlyBundle: false,
	},
});
