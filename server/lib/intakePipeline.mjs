/**
 * One share, start to finish: store every part, read the batch, match each
 * document it holds to a client, and queue each for Smart Inbox. The parts
 * are always stored before the model is asked anything, so a failed read
 * loses nothing — every part is then queued unread for a person to sort.
 *
 * Dependencies are passed in so the whole flow is testable without a
 * database or a model; the route supplies the real ones.
 */
import { randomUUID } from 'node:crypto';
import { buildRoster, decideMatch } from './documentMatch.mjs';
import { documentFileName } from './intake.mjs';
import { unreadDocument } from './intakeReader.mjs';
import { sha256 } from './intakeStore.mjs';

/**
 * parts: [{ fileName, contentType, bytes }]. Returns
 * { duplicate: true } when this user already shared exactly these files
 * this week, else { batchId, read, documents: [...] } describing what was
 * queued — enough for the share screen to say "Filing under X".
 */
export async function processBatch({ parts, userId, source, holdMinutes = 0 }, deps) {
  const { saveBatch, findDuplicateBatch, queueDocument, readBatch, readPracticeSnapshot, env = process.env } = deps;

  if (await findDuplicateBatch(userId, parts.map((p) => sha256(p.bytes)))) return { duplicate: true };

  const batchId = `inb_${randomUUID()}`;
  const uploadIds = await saveBatch({ batchId, userId, source, parts });

  const snapshot = env.ANTHROPIC_API_KEY ? await readPracticeSnapshot() : null;
  const read = snapshot
    ? await readBatch({ parts: parts.map((p) => ({ bytes: p.bytes, mediaType: p.contentType, fileName: p.fileName })), roster: buildRoster(snapshot) })
    : null;
  const documents = read ?? parts.map((_, i) => unreadDocument([i]));

  const clientName = (id) => snapshot?.clients?.find((c) => c.id === id)?.name ?? null;
  const queued = [];
  for (const doc of documents) {
    const docParts = doc.parts.map((i) => parts[i]);
    const decision = read ? decideMatch(doc, snapshot) : { kind: 'unsure', candidates: [], suggestion: { clientId: null, documentType: doc.documentType, confidence: 0, rationale: doc.rationale } };
    const suggestion = { ...decision.suggestion, summary: doc.summary };
    const filed = decision.kind === 'filed';
    const fileName = documentFileName(docParts);
    const docUploadIds = doc.parts.map((i) => uploadIds[i]);
    const id = await queueDocument({
      batchId,
      source,
      userId,
      uploadIds: docUploadIds,
      fileName,
      sizeBytes: docParts.reduce((sum, p) => sum + p.bytes.length, 0),
      suggestion,
      filed,
      holdMinutes,
    });
    const candidates = filed ? [] : decision.candidates;
    queued.push({
      id,
      fileName,
      uploadIds: docUploadIds,
      filed,
      clientId: suggestion.clientId ?? null,
      clientName: clientName(suggestion.clientId),
      candidates: candidates.map((cid) => ({ id: cid, name: clientName(cid) })),
      documentType: suggestion.documentType,
      summary: suggestion.summary || null,
      confidence: suggestion.confidence,
      rationale: suggestion.rationale,
    });
  }
  return { batchId, read: Boolean(read), documents: queued };
}
