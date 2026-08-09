import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
