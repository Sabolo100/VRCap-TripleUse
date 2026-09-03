import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath, URL } from 'node:url';

/**
 * WebXR requires a secure context. `npm run dev` serves plain http on localhost
 * (which counts as secure) - to test on a Quest over the LAN use `dev:https`,
 * which enables the self-signed certificate plugin below.
 */
export default defineConfig(({ mode }) => ({
  plugins: [basicSsl()],
  resolve: {
    alias: {
      '@vrcap/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production',
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
}));
