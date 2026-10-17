/**
 * A share started inside the app — pictures taken or files picked with the
 * "Add a document" button — handed to the share page without a round trip
 * through the service worker's Cache Storage (which is only for what
 * Android's share sheet delivers). Held in memory for the one navigation
 * that follows; opening /share?id= afterwards, or on another device, finds
 * nothing, which is correct: nothing has been sent yet.
 */
import { newId } from './ids';
import type { ParkedShare } from './sharedFiles';

const pending = new Map<string, ParkedShare>();

/** Keeps the share for the next page and returns the id to open it with. */
export function stashPendingShare(share: ParkedShare): string {
  const id = newId('app');
  pending.set(id, share);
  return id;
}

/** Hands the share over, once: it is forgotten as it is taken. */
export function takePendingShare(id: string): ParkedShare | null {
  const share = pending.get(id) ?? null;
  pending.delete(id);
  return share;
}
