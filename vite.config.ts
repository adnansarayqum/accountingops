/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import companiesHouseRouter from './server/routes/companiesHouse.mjs';
import authRouter from './server/routes/auth.mjs';
import practiceDataRouter from './server/routes/practiceData.mjs';
import messagesRouter from './server/routes/messages.mjs';
import { healthPayload } from './server/lib/health.mjs';
import { securityHeaders } from './server/lib/securityHeaders.mjs';

/**
 * Mounts the exact same Express routers the production server uses, so
 * /api/* (and /health) behave identically in `npm run dev` and on Railway.
 * A bare `express.Router()` does not get Express's request/response
 * augmentation (req.query, res.json, …) unless it runs through a full
 * `express()` app — mounting a Router directly on Vite's Connect middleware
 * skips that step. Wrapping them in a minimal app first mirrors exactly how
 * server/index.mjs mounts the same routers in production.
 *
 * /health matters here beyond parity for its own sake: src/application/
 * auth.ts checks /health's `database` flag before ever calling
 * /api/auth/me, specifically to avoid a failed (503) request when no
 * database is configured. Without a matching /health here, that request
 * falls through to Vite's SPA fallback (which returns index.html, not
 * JSON) and the check silently fails to short-circuit.
 *
 * The production security headers ride along too, so the e2e suite (which
 * runs against `vite preview`) exercises the same Content-Security-Policy
 * the deployed app serves. Dev mode is the one exception: Vite and the
 * React plugin inject inline scripts for HMR, which that policy forbids,
 * so dev gets every header except the CSP.
 */
function apiMiddleware(): Plugin {
  const build = (options: { csp: boolean }) => {
    const app = express();
    app.use(securityHeaders(options));
    app.get('/health', async (_req, res) => res.json(await healthPayload()));
    app.use('/api/companies-house', companiesHouseRouter);
    app.use('/api/messages', messagesRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/practice-data', practiceDataRouter);
    return app;
  };
  return {
    name: 'api-middleware',
    configureServer(server) {
      server.middlewares.use(build({ csp: false }));
    },
    configurePreviewServer(server) {
      server.middlewares.use(build({ csp: true }));
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
