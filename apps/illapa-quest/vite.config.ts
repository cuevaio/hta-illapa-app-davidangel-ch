import { QUEST_DEV_PORT } from "@hack-the-andes-project/ui/lib/route-review-3d/constants";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [basicSsl()],
	server: {
		host: true,
		port: QUEST_DEV_PORT,
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					three: ["three"],
				},
			},
		},
	},
});
