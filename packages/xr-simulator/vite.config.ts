import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

// The browser only talks to our tiles API through this same-origin proxy, so the
// Quest on https://…:5443 never makes mixed-content requests. VITE_TILES_URL bypasses it.
const tilesProxy = {
  '/tiles-api': {
    target: process.env.TILES_API_URL ?? 'http://127.0.0.1:8080',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/tiles-api/, ''),
  },
  // Weather layers backend (services/weather): /weather-api/api/layers -> WEATHER_API_URL/api/layers.
  '/weather-api': {
    target: process.env.WEATHER_API_URL ?? 'http://127.0.0.1:8788',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/weather-api/, ''),
  },
};

// `npm run dev:https` serves over self-signed HTTPS on the LAN, which WebXR
// requires on any origin other than localhost (e.g. a Meta Quest on Wi-Fi).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { host: true, proxy: tilesProxy },
  preview: { proxy: tilesProxy },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        diagnostics: fileURLToPath(new URL('./diagnostics.html', import.meta.url)),
        xrBabylon: fileURLToPath(new URL('./xr-babylon.html', import.meta.url)),
        gpuTests: fileURLToPath(new URL('./tests.html', import.meta.url)),
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
