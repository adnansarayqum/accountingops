/**
 * Client portal routes.
 *
 * Two halves with very different trust:
 *
 *  - /p/:token — PUBLIC. A client with no account, holding a link. Rate
 *    limited by address, every failure a uniform 404, every input bounded
 *    by lib/portal.mjs before anything is stored. Reads the practice
 *    snapshot to build the client's view; never writes it.
 *
 *  - everything else — the practice, signed in. Creates links (the token
 *    is returned once and never stored), lists them, revokes them, reads
 *    what clients sent, and marks activity as pulled in.
 *
 * Needs a database (links and files have to live somewhere), so the whole
 * router answers 503 without one and the browser-only mode is untouched.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { cleanName, cleanNote, isPurpose, linkProblem, looksLikeToken, MAX_FILE_BYTES, publicJobView, validateUpload } from '../lib/portal.mjs';
import { createLink, findLinkById, findLinkByToken, linksForJob, markActivityApplied, markOpened, markUsed, pendingActivity, readSnapshot, readUpload, recordApprovalDecision, revokeLink, storeClientUpload, uploadCountForLink } from '../lib/portalStore.mjs';

const router = express.Router();

/**
 * Whether the portal can be offered at all. Open and always 200, like every
 * other integration's /status: the app asks on every page load, and a 503
 * here would be logged by the browser as an error on every route in the
 * browser-only mode, where "off" is the normal answer.
 */
router.get('/status', (_req, res) => {
  res.json({ configured: isDatabaseConfigured(), maxFileBytes: MAX_FILE_BYTES });
});

router.use((req, res, next) => (isDatabaseConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));

// ---------------------------------------------------------------------------
// Public: a client holding a link
// ---------------------------------------------------------------------------

const publicRouter = express.Router();

// Per address, not per token: a guesser cycles tokens, and a single client
// on a slow connection retrying an upload should never be locked out.
publicRouter.use(createRateLimiter({ windowMs: 60 * 1000, max: 40, keyFor: (req) => req.ip, name: 'rate_limited' }));

// One JSON limit covers the largest upload plus its base64 overhead; anything
// larger is refused by the body parser before it is read into memory.
publicRouter.use(express.json({ limit: `${Math.ceil((MAX_FILE_BYTES * 4) / 3 / 1024) + 64}kb` }));

/** Loads and checks the link. Every way it can be wrong is the same 404. */
async function loadLink(req, res, next) {
  const token = String(req.params.token ?? '');
  if (!looksLikeToken(token)) return res.status(404).json({ error: 'not_found' });
  const link = await findLinkByToken(token);
  if (linkProblem(link)) return res.status(404).json({ error: 'not_found' });
  req.portalLink = link;
  next();
}

publicRouter.get('/:token', loadLink, async (req, res) => {
  const link = req.portalLink;
  const view = publicJobView(await readSnapshot(), link);
  if (!view) return res.status(404).json({ error: 'not_found' });
  await markOpened(link.id).catch(() => {});
  res.json(view);
});

/** The file the accountant attached for an approval link — the accounts to be approved. */
publicRouter.get('/:token/attachment', loadLink, async (req, res) => {
  const link = req.portalLink;
  if (!link.attachmentId) return res.status(404).json({ error: 'not_found' });
  const file = await readUpload(link.attachmentId);
  if (!file || file.linkId !== link.id || file.direction !== 'to_client') return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.content);
});

publicRouter.post('/:token/upload', loadLink, async (req, res) => {
  const link = req.portalLink;
  if (link.purpose !== 'upload') return res.status(404).json({ error: 'not_found' });
  const { fileName, contentType, contentBase64, requestItemId } = req.body ?? {};
  const existingCount = await uploadCountForLink(link.id);
  const checked = validateUpload({ fileName, contentType, contentBase64 }, { existingCount });
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  // The request item must belong to this link's job, or it is ignored: a
  // client can only ever tick off what they were asked for.
  const snapshot = await readSnapshot();
  const item = (snapshot?.requestItems ?? []).find((i) => i.id === requestItemId && i.jobId === link.jobId);
  const content = Buffer.from(contentBase64, 'base64');
  if (content.length === 0 || content.length > MAX_FILE_BYTES) return res.status(400).json({ error: 'too_large' });

  const { uploadId } = await storeClientUpload({ link, requestItemId: item?.id ?? null, fileName: checked.fileName, contentType: checked.contentType, content });
  res.status(201).json({ ok: true, uploadId, fileName: checked.fileName });
});

publicRouter.post('/:token/approve', loadLink, async (req, res) => {
  const link = req.portalLink;
  if (link.purpose !== 'approve') return res.status(404).json({ error: 'not_found' });
  const decision = req.body?.decision === 'rejected' ? 'rejected' : req.body?.decision === 'approved' ? 'approved' : null;
  const actorName = cleanName(req.body?.name);
  if (!decision) return res.status(400).json({ error: 'decision_required' });
  if (!actorName) return res.status(400).json({ error: 'name_required' });

  // Single use: the first decision wins, and a second submission of the same
  // link is a 404 like any other dead link.
  const claimed = await markUsed(link.id);
  if (!claimed) return res.status(404).json({ error: 'not_found' });
  await recordApprovalDecision({ link, decision, actorName, note: cleanNote(req.body?.note) });
  res.json({ ok: true, decision });
});

router.use('/p', publicRouter);

// ---------------------------------------------------------------------------
// Practice: signed in
// ---------------------------------------------------------------------------

router.use(requireAuth);
router.use(express.json({ limit: `${Math.ceil((MAX_FILE_BYTES * 4) / 3 / 1024) + 64}kb` }));

/**
 * Creates a link. The response carries the token exactly once; the store
 * keeps only its hash, so there is no "show me the link again" — a lost
 * link is revoked and a new one made.
 */
router.post('/links', async (req, res) => {
  const { clientId, jobId, purpose, message, expiresInDays, attachment } = req.body ?? {};
  if (typeof clientId !== 'string' || typeof jobId !== 'string' || !isPurpose(purpose)) return res.status(400).json({ error: 'invalid_request' });

  const snapshot = await readSnapshot();
  const job = (snapshot?.jobs ?? []).find((j) => j.id === jobId);
  if (!job || job.clientId !== clientId) return res.status(404).json({ error: 'job_not_found' });

  let stored = null;
  if (attachment) {
    if (purpose !== 'approve') return res.status(400).json({ error: 'attachment_only_for_approval' });
    const checked = validateUpload(attachment);
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const content = Buffer.from(attachment.contentBase64, 'base64');
    if (content.length === 0 || content.length > MAX_FILE_BYTES) return res.status(400).json({ error: 'too_large' });
    stored = { fileName: checked.fileName, contentType: checked.contentType, content };
  }

  const { id, token } = await createLink({ clientId, jobId, purpose, message: cleanNote(message), expiresInDays, createdBy: req.user.id, attachment: stored });
  const base = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  res.status(201).json({ id, url: `${base.replace(/\/$/, '')}/portal/${token}` });
});

router.get('/links', async (req, res) => {
  const jobId = String(req.query.jobId ?? '');
  if (!jobId) return res.status(400).json({ error: 'job_id_required' });
  const links = await linksForJob(jobId);
  res.json({ links: links.map((l) => ({ ...l, state: linkProblem(l) ?? 'live' })) });
});

router.post('/links/:id/revoke', async (req, res) => {
  const link = await findLinkById(String(req.params.id));
  if (!link) return res.status(404).json({ error: 'not_found' });
  res.json({ revoked: await revokeLink(link.id) });
});

/** What clients have done since the app last looked. The app applies it through its own store and acks. */
router.get('/activity', async (_req, res) => {
  res.json({ activity: await pendingActivity() });
});

router.post('/activity/ack', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  res.json({ applied: await markActivityApplied(ids) });
});

/** A file a client sent. Signed-in practice only; the bytes never go anywhere else. */
router.get('/uploads/:id', async (req, res) => {
  const file = await readUpload(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.content);
});

export default router;
