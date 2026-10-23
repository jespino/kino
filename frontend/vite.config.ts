import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The studio's backend is the Go service (internal/app). In a browser, run
// `kino serve` and `npm run dev` (or just `make dev`): Vite proxies the API to
// it. Under `wails3 dev` the desktop app serves the API itself.
const backend = process.env.KINO_BACKEND ?? 'http://127.0.0.1:34116';

/**
 * `virtual:kino-player`: the HTML exporter's player (frontend/player) bundled
 * into one minified script, as a string the exporter writes into the page.
 */
function kinoPlayer(): Plugin {
  const id = 'virtual:kino-player';
  const entry = fileURLToPath(new URL('./player/main.ts', import.meta.url));
  return {
    name: 'kino-player',
    resolveId: (s) => (s === id ? '\0' + id : undefined),
    async load(s) {
      if (s !== '\0' + id) return;
      const out = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'iife', target: 'es2022', write: false, metafile: true });
      // rebuild in dev when the player or the engine changes
      Object.keys(out.metafile.inputs).forEach((f) => this.addWatchFile(resolve(f)));
      return `export default ${JSON.stringify(out.outputFiles[0].text)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), kinoPlayer()],
  server: {
    // explicit IPv4: the Wails dev proxy (FRONTEND_DEVSERVER_URL) connects over IPv4
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 5173,
    // the studio imports the engine, examples and fonts from the repository root
    fs: { allow: ['..'] },
    proxy: {
      '/rpc': backend,
      '/__kino': backend,
      '/events': { target: backend, changeOrigin: true },
    },
  },
  // embedded into the desktop app by main.go
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
