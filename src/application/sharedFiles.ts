/**
 * The page's side of what public/sw.js parks in Cache Storage when Android
 * shares files into the installed app. Same-origin, so the page can read
 * exactly what the worker wrote, then clear it once it has been sent on.
 */
import type { ShareFile } from '../integrations/intake';

export const SHARE_CACHE = 'shared-into-app';

export interface ParkedShare {
  files: File[];
  text: string;
}

interface ParkedMeta {
  files: { name: string; type: string }[];
  text: string;
}

/** The share the worker parked under `id`, or null if there is none (already sent, or opened on another device). */
export async function readParkedShare(id: string): Promise<ParkedShare | null> {
  if (typeof caches === 'undefined') return null;
  const cache = await caches.open(SHARE_CACHE);
  const metaResponse = await cache.match(`/__shared/${id}/meta`);
  if (!metaResponse) return null;
  const meta = (await metaResponse.json()) as ParkedMeta;
  const files: File[] = [];
  for (let index = 0; index < meta.files.length; index += 1) {
    const response = await cache.match(`/__shared/${id}/${index}`);
    if (!response) continue;
    const { name, type } = meta.files[index];
    files.push(new File([await response.arrayBuffer()], name || `shared-${index + 1}`, { type: type || response.headers.get('Content-Type') || '' }));
  }
  return { files, text: meta.text ?? '' };
}

export async function clearParkedShare(id: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(SHARE_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.filter((request) => new URL(request.url).pathname.startsWith(`/__shared/${id}/`)).map((request) => cache.delete(request)));
}

/** Types the server can read. Anything else is left out before upload and named on the share screen. */
const SENDABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'];

const BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain' };

/** A file's type, trusting its extension when the sharing app didn't say (some send an empty or generic type). */
export function sendableType(file: File): string | null {
  const declared = file.type.toLowerCase().split(';')[0].trim();
  if (SENDABLE.includes(declared)) return declared;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return BY_EXTENSION[ext] ?? null;
}

/** A file's bytes via FileReader, which every browser (and the test DOM) has. */
export function fileBytes(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** The files ready to send, plus the names of any the server couldn't read. */
export async function prepareFiles(files: File[]): Promise<{ ready: ShareFile[]; skipped: string[] }> {
  const ready: ShareFile[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const contentType = sendableType(file);
    if (!contentType) {
      skipped.push(file.name);
      continue;
    }
    ready.push({ fileName: file.name, contentType, contentBase64: toBase64(await fileBytes(file)) });
  }
  return { ready, skipped };
}
