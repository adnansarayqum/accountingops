/**
 * Reading a shared bank statement: claim it, load its pages, ask the model,
 * store the lines. The claim is taken before anything slow happens so the
 * app can show "reading…" at once, and each document is read once however
 * often it is asked for. Reads run one at a time through a small in-process
 * queue — they are slow and expensive, and a burst of statements shouldn't
 * become a burst of simultaneous model requests.
 *
 * Dependencies are passed in so the flow tests without a database or a
 * model; the routes supply the real ones.
 */
import { transactionsModel } from './bankStatement.mjs';

/** More than this waiting means something is wrong; further reads are declined rather than piled up. */
export const MAX_QUEUED_READS = 20;

let tail = Promise.resolve();
let waiting = 0;

/** Runs `task` after every earlier one. Returns false when too many are already waiting. */
export function enqueueRead(task) {
  if (waiting >= MAX_QUEUED_READS) return false;
  waiting += 1;
  tail = tail.then(task).catch(() => {}).finally(() => {
    waiting -= 1;
  });
  return true;
}

/** Test hook: resolves once everything queued so far has finished. */
export function settled() {
  return tail;
}

function log(message) {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'bank-extraction', message }));
}

/** Loads the document's pages and reads the statement; whatever happens, the claim ends as extracted or failed. */
export async function runRead(claimId, uploadIds, deps) {
  const { readUpload, extractStatement, saveStatement, failStatement, env = process.env } = deps;
  try {
    const parts = [];
    for (const id of uploadIds) {
      const file = await readUpload(id);
      if (!file) {
        await failStatement(claimId, 'A page of that document is missing.');
        return { status: 'failed' };
      }
      parts.push({ bytes: file.content, mediaType: file.contentType, fileName: file.fileName });
    }
    const result = await extractStatement({ parts }, { env });
    if (!result.ok) {
      await failStatement(claimId, result.message);
      return { status: 'failed' };
    }
    await saveStatement(claimId, result, transactionsModel(env));
    return { status: 'extracted' };
  } catch (err) {
    log(`Could not read a statement: ${err?.message ?? err}`);
    await failStatement(claimId, 'The statement could not be read.').catch(() => {});
    return { status: 'failed' };
  }
}

/**
 * Asks for a document's transactions to be read. Returns its status at once:
 * 'reading' (this call queued it), the existing 'reading' / 'extracted' /
 * 'failed' state of an earlier call, 'busy' when too many reads are waiting,
 * or 'not_configured' without an API key.
 */
export async function startRead(uploadIds, deps) {
  const { claimStatement, failStatement, env = process.env } = deps;
  if (!env.ANTHROPIC_API_KEY) return { status: 'not_configured' };
  const claim = await claimStatement(uploadIds);
  if (!claim.claimed) return { id: claim.id, status: claim.status };
  const queued = enqueueRead(() => runRead(claim.id, uploadIds, deps));
  if (!queued) {
    await failStatement(claim.id, 'Too many statements are being read just now. Try again in a few minutes.');
    return { id: claim.id, status: 'busy' };
  }
  return { id: claim.id, status: 'reading' };
}

/** After a share has been read: start reading the transactions of every document it found to be a bank statement. */
export async function readStatementsIn(result, deps) {
  if (!result?.read) return;
  for (const doc of result.documents ?? []) {
    if (doc.documentType !== 'Bank statement' || !Array.isArray(doc.uploadIds) || doc.uploadIds.length === 0) continue;
    try {
      await startRead(doc.uploadIds, deps);
    } catch (err) {
      log(`Could not start reading a statement: ${err?.message ?? err}`);
    }
  }
}
