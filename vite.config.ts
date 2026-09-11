/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import companiesHouseRouter from './server/routes/companiesHouse.mjs';

/**
 * Mounts the exact same Express router the production server uses, so
 * /api/companies-house behaves identically in `npm run dev` and on Railway.
 * A bare `express.Router()` does not get Express's request/response
 * augmentation (req.query, res.json, …) unless it runs through a full
 * `express()` app — mounting the Router directly on Vite's Connect
 * middleware skips that step. Wrapping it in a minimal app first mirrors
 * exactly how server/index.mjs mounts the same router in production.
 */
function apiMiddleware(): Plugin {
  const app = express();
  app.use('/api/companies-house', companiesHouseRouter);
  return {
    name: 'api-middleware',
    configureServer(server) {
      server.middlewares.use(app);
    },
    configurePreviewServer(server) {
      server.middlewares.use(app);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiMiddleware()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], icons: ['lucide-react'] },
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.mjs'],
    css: false,
  },
});
