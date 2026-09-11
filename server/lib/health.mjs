/**
 * Shared base for the /health response. Mounted identically in
 * server/index.mjs (production) and vite.config.ts's dev/preview
 * middleware — src/application/auth.ts checks `database` here before ever
 * calling /api/auth/me, so this needs to behave the same in both places or
 * that check silently falls through to a request that 503s.
 */
import { isDatabaseConfigured } from './db.mjs';

export function healthPayload() {
  return { status: 'ok', database: isDatabaseConfigured() };
}
