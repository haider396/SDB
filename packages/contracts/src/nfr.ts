/**
 * Non-functional requirement constants for file uploads.
 * Source: docs/01-PRODUCT-OVERVIEW.md §7, NFR-4 and NFR-5.
 */

/** NFR-4: maximum upload size per file, in megabytes. */
export const MAX_FILE_SIZE_MB = 25;

/**
 * NFR-5: accepted upload MIME types — pdf, docx, png, jpeg, webp, mp4, webm,
 * mp3 (audio/mpeg), m4a (audio/mp4).
 */
export const ACCEPTED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
] as const;

export type AcceptedUploadMimeType = (typeof ACCEPTED_UPLOAD_MIME_TYPES)[number];

export function isAcceptedUploadMimeType(
  mimeType: string,
): mimeType is AcceptedUploadMimeType {
  return (ACCEPTED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType);
}
