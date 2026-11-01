import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly rather than drift to 5174 if 5173 is taken (the forwarded port must match).
    strictPort: true,
    // Dev containers (Codespaces) set VITE_HOST=0.0.0.0 so port forwarding can reach Vite;
    // on your own machine it stays on localhost.
    host: process.env.VITE_HOST || 'localhost',
    proxy: { '/api': 'http://localhost:4000' },
  },
});
