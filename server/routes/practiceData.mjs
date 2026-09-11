/**
 * Server-side persistence for the whole PracticeData aggregate, gated
 * behind a signed-in session. Stores one JSONB snapshot per practice — the
 * interim adapter described in db/schema.sql's header comment, chosen so
 * the client's existing store/mutate architecture didn't need a rewrite to
 * get real, shared, multi-user persistence.
 */
import express from 'express';
import { isDatabaseConfigured, query } from '../lib/db.mjs';
import { requireAuth } from './auth.mjs';

const PRACTICE_ID = 'prac_main';

const router = express.Router();
router.use(express.json({ limit: '10mb' }));

router.use(async (req, res, next) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'not_configured' });
  next();
});

router.use(requireAuth);

router.get('/', async (_req, res) => {
  const { rows } = await query('select data from practice_snapshots where practice_id = $1', [PRACTICE_ID]);
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ data: rows[0].data });
});

router.put('/', async (req, res) => {
  const { data } = req.body ?? {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'invalid_body' });
  await query(
    `insert into practice_snapshots (practice_id, data, updated_at) values ($1, $2, now())
     on conflict (practice_id) do update set data = excluded.data, updated_at = now()`,
    [PRACTICE_ID, data],
  );
  res.json({ ok: true });
});

export default router;
