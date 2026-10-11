/**
 * Bank statement transactions: what was read off the statements shared into
 * the app (lib/bankStatement.mjs), for the practice to view, correct and
 * export. Signed-in users only; the whole router answers 503 without a
 * database, so browser-only mode is untouched.
 *
 * Statements are found through the documents a client already has: the app
 * sends the upload ids of a client's bank-statement documents and gets back
 * whatever was read from them, so the server never has to hold a client id.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { BANK_CATEGORIES, extractStatement } from '../lib/bankStatement.mjs';
import { claimStatement, failStatement, MAX_QUERY_UPLOADS, queryStatements, saveStatement, setCategory, uploadsExist } from '../lib/bankStore.mjs';
import { startRead } from '../lib/bankExtraction.mjs';
import { readUpload } from '../lib/intakeStore.mjs';

const router = express.Router();

router.use((req, res, next) => (isDatabaseConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));
router.use(requireAuth);
router.use(express.json({ limit: '32kb' }));

// Each read is a long, paid model request.
const readLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyFor: (req) => req.user.id, name: 'rate_limited' });

const UPLOAD_ID = /^inu_[\w-]{1,100}$/;
const idsFrom = (value, max) => (Array.isArray(value) && value.length > 0 && value.length <= max && value.every((v) => typeof v === 'string' && UPLOAD_ID.test(v)) ? value : null);

router.post('/statements/query', async (req, res) => {
  const ids = idsFrom(req.body?.uploadIds, MAX_QUERY_UPLOADS);
  if (!ids) return res.status(400).json({ error: 'invalid_uploads' });
  res.json({ statements: await queryStatements(ids), canRead: Boolean(process.env.ANTHROPIC_API_KEY), categories: BANK_CATEGORIES });
});

// Asks for a document's transactions to be read: the pages of one document, in order.
router.post('/statements/read', readLimiter, async (req, res) => {
  const ids = idsFrom(req.body?.uploadIds, 20);
  if (!ids) return res.status(400).json({ error: 'invalid_uploads' });
  if (!(await uploadsExist(ids))) return res.status(404).json({ error: 'not_found' });
  const result = await startRead(ids, { claimStatement, failStatement, saveStatement, readUpload, extractStatement });
  if (result.status === 'not_configured') return res.status(503).json({ error: 'not_configured' });
  res.status(result.status === 'reading' ? 202 : 200).json({ status: result.status });
});

router.patch('/transactions/:id', async (req, res) => {
  const category = req.body?.category;
  if (typeof category !== 'string' || !BANK_CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid_category' });
  const updated = await setCategory(String(req.params.id), category);
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
});

export default router;
