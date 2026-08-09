import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

let buildId = 'dev';
try {
  buildId = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout */
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Dev-mode WebSocket passthrough to the room server.
      '/ws': { target: 'http://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
