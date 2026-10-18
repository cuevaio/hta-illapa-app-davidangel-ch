// Runs a TypeScript tool through Vite's module loader (same resolution as the app, no extra deps).
// Usage: node tools/run-ts.mjs tools/gen-tiles-types.ts [args…]
import { createServer } from 'vite';

const [entry, ...args] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const mod = await server.ssrLoadModule('/' + entry.replace(/^\.?\//, ''));
  process.exitCode = (await mod.main(args)) ?? 0;
} finally {
  await server.close();
}
