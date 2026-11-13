import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['lucide-react'] },
  server: { port: Number(process.env.WEB_PORT || 4317), strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 4318}`, changeOrigin: false } } },
  build: { sourcemap: false },
});
