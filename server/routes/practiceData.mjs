/**
 * Server-side persistence for the whole PracticeData aggregate, gated
 * behind a signed-in session. Stores one JSONB snapshot per practice — the
 * interim adapter described in db/schema.sql's header comment, chosen so
 * the client's existing store/mutate architecture didn't need a rewrite to
 * get real, shared, multi-user persistence.
 *
 * Writes are versioned. Every snapshot carries a version; a PUT names the
 * version it was built on (`expectedVersion`) and is refused with 409 —
 * carrying the current snapshot — when the stored one has moved on, so two
 * people editing at once can't silently overwrite each other. Every
 * accepted write is also kept in practice_snapshot_history (the last
 * HISTORY_KEEP versions), so any overwrite is recoverable.
 */
import express from 'express';
import { ensureSchema, getPool, isDatabaseConfigured, query } from '../lib/db.mjs';
import { validatePracticeData } from '../lib/practiceDataShape.mjs';
import { requireAuth } from './auth.mjs';

const PRACTICE_ID = 'prac_main';

// A whole snapshot for a practice this size is well under 200 KB (the
// 18-client test fixture serialises to ~175 KB), so 2 MB is roughly ten
// times the largest save we expect while still bounding what an
// authenticated client can make the server buffer in memory.
const BODY_LIMIT = '2mb';

/** Versions kept per practice. At a few saves an hour this is days of history. */
export const HISTORY_KEEP = 50;

const router = express.Router();

router.use(async (req, res, next) => {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'not_configured' });
  try {
    await ensureSchema();
    next();
  } catch (err) {
    next(err);
  }
});

// Authenticate BEFORE parsing the body — an anonymous request should not be
// able to make the server buffer and parse megabytes of JSON.
router.use(requireAuth);
router.use(express.json({ limit: BODY_LIMIT }));

router.get('/', async (_req, res) => {
  const { rows } = await query('select data, version from practice_snapshots where practice_id = $1', [PRACTICE_ID]);
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ data: rows[0].data, version: Number(rows[0].version) });
});

/**
 * Writes `data` as the next version, provided the stored version is still
 * `expectedVersion`. Runs in one transaction with the row locked, so two
 * simultaneous writers can't both pass the check. Resolves to the new
 * version, or to a conflict describing the snapshot that is actually
 * stored.
 */
async function writeSnapshot({ data, expectedVersion, savedBy }) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const current = await client.query('select data, version from practice_snapshots where practice_id = $1 for update', [PRACTICE_ID]);
    const row = current.rows[0];
    if (row && Number(row.version) !== expectedVersion) {
      await client.query('rollback');
      return { conflict: { version: Number(row.version), data: row.data } };
    }
    const nextVersion = row ? Number(row.version) + 1 : 1;
    if (row) {
      await client.query('update practice_snapshots set data = $2, version = $3, saved_by = $4, updated_at = now() where practice_id = $1', [PRACTICE_ID, data, nextVersion, savedBy]);
    } else {
      await client.query('insert into practice_snapshots (practice_id, data, version, saved_by, updated_at) values ($1, $2, $3, $4, now())', [PRACTICE_ID, data, nextVersion, savedBy]);
    }
    await client.query('insert into practice_snapshot_history (practice_id, version, data, saved_by) values ($1, $2, $3, $4)', [PRACTICE_ID, nextVersion, data, savedBy]);
    await client.query('delete from practice_snapshot_history where practice_id = $1 and version <= $2', [PRACTICE_ID, nextVersion - HISTORY_KEEP]);
    await client.query('commit');
    return { version: nextVersion };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.put('/', async (req, res) => {
  const { data, expectedVersion } = req.body ?? {};
  const problem = validatePracticeData(data);
  if (problem) return res.status(400).json({ error: 'invalid_shape', reason: problem });
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: 'expected_version_required' });
  const result = await writeSnapshot({ data, expectedVersion, savedBy: req.user.id });
  if (result.conflict) return res.status(409).json({ error: 'version_conflict', ...result.conflict });
  res.json({ ok: true, version: result.version });
});

/** The versions still on file, newest first — what a restore can go back to. */
router.get('/history', async (_req, res) => {
  const [{ rows }, current] = await Promise.all([
    query('select version, saved_by as "savedBy", saved_at as "savedAt" from practice_snapshot_history where practice_id = $1 order by version desc limit $2', [PRACTICE_ID, HISTORY_KEEP]),
    query('select version from practice_snapshots where practice_id = $1', [PRACTICE_ID]),
  ]);
  res.json({
    current: current.rows[0] ? Number(current.rows[0].version) : 0,
    versions: rows.map((r) => ({ version: Number(r.version), savedBy: r.savedBy, savedAt: r.savedAt })),
  });
});

/**
 * Brings back an earlier version as a NEW version on top of the current
 * one — history is never rewritten, so a restore is itself undoable. The
 * caller passes the version it currently holds; a restore over someone
 * else's unseen change is refused like any other stale write.
 */
router.post('/restore', async (req, res) => {
  const { version, expectedVersion } = req.body ?? {};
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: 'version_required' });
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ error: 'expected_version_required' });
  const { rows } = await query('select data from practice_snapshot_history where practice_id = $1 and version = $2', [PRACTICE_ID, version]);
  if (rows.length === 0) return res.status(404).json({ error: 'version_not_found' });
  const result = await writeSnapshot({ data: rows[0].data, expectedVersion, savedBy: req.user.id });
  if (result.conflict) return res.status(409).json({ error: 'version_conflict', ...result.conflict });
  res.json({ ok: true, version: result.version, data: rows[0].data });
});

// Body-parser failures are the caller's fault, not ours — report them as
// such instead of letting them surface as a generic 500.
router.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  next(err);
});

export default router;
