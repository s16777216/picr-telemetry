import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web UI lives in `web/` and builds to `dist/web`, which the UI server
// serves at `/` (`add-review-trace-server` design, Decision 7). In development,
// `npx vite` proxies the API to a service on port 8080.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8080', '/healthz': 'http://127.0.0.1:8080' } },
});
