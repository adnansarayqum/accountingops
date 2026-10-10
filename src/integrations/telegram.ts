/**
 * The retired Telegram bot: only the link to a photo it filed remains, for
 * Smart Inbox items and documents that came in that way.
 */
export function telegramUploadUrl(uploadId: string): string {
  return `/api/telegram/uploads/${encodeURIComponent(uploadId)}`;
}
