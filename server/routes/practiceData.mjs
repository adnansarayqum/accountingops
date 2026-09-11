/**
 * Server-side persistence for the whole PracticeData aggregate, gated
 * behind a signed-in session. Stores one JSONB snapshot per practice — the
 * interim adapter described in db/schema.sql's header comment, chosen so
 * the client's existing store/mutate architecture didn't need a rewrite to
 * get real, shared, multi-user persistence.
 */
import express from 'express';
import { isDatabaseConfigured, query } from '../lib/db.mjs';
import { validatePracticeData } from '../lib/practiceDataShape.mjs';
import { requireAuth } from './auth.mjs';

const PRACTICE_ID = 'prac_main';

// A whole snapshot for a practice this size is well under 200 KB (the
// 18-client test fixture serialises to ~175 KB), so 2 MB is roughly ten
// times the largest save we expect while still bounding what an
// authenticated client can make the server buffer in memory.
const BODY_LIMIT = '2mb';

const router = express.Router();

router.use(async (req, res, next) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'not_configured' });
  next();
});

// Authenticate BEFORE parsing the body — an anonymous request should not be
// able to make the server buffer and parse megabytes of JSON.
router.use(requireAuth);
router.use(express.json({ limit: BODY_LIMIT }));

router.get('/', async (_req, res) => {
  const { rows } = await query('select data from practice_snapshots where practice_id = $1', [PRACTICE_ID]);
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ data: rows[0].data });
});

router.put('/', async (req, res) => {
  const { data } = req.body ?? {};
  const problem = validatePracticeData(data);
  if (problem) return res.status(400).json({ error: 'invalid_shape', reason: problem });
  await query(
    `insert into practice_snapshots (practice_id, data, updated_at) values ($1, $2, now())
     on conflict (practice_id) do update set data = excluded.data, updated_at = now()`,
    [PRACTICE_ID, data],
  );
  res.json({ ok: true });
});

// Body-parser failures are the caller's fault, not ours — report them as
// such instead of letting them surface as a generic 500.
router.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  next(err);
});

export default router;
