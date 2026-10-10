/**
 * The retired Telegram bot's one remaining route: the photos it filed, which
 * Smart Inbox items and documents still link to. Signed-in only, served
 * inline (always an image) with nosniff. Sharing into the app
 * (routes/intake.mjs) replaced the bot; its tables are kept, not dropped,
 * so nothing it stored is lost.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { requireAuth } from './auth.mjs';
import { readUpload } from '../lib/telegramStore.mjs';

const router = express.Router();

router.use((req, res, next) => (isDatabaseConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));
router.use(requireAuth);

router.get('/uploads/:id', async (req, res) => {
  const file = await readUpload(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.content);
});

export default router;
