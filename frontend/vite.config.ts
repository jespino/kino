import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The studio's backend is the Go service (internal/app). In a browser, run
// `kino serve` and `npm run dev` (or just `make dev`): Vite proxies the API to
// it. Under `wails3 dev` the desktop app serves the API itself.
const backend = process.env.KINO_BACKEND ?? 'http://127.0.0.1:34116';

export default defineConfig({
  plugins: [react()],
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
