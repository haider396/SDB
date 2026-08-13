/**
 * Read-time photo URL decoration (UX 1.4). `photo_path` is a raw storage
 * path in a PRIVATE bucket; renderable URLs are short-lived signed URLs
 * (DOWNLOAD_URL_TTL_SECONDS, the established 300 s pattern) generated at
 * read time — ONE batched port call per distinct path set.
 *
 * Decoration must never fail a read: any signing failure degrades to a null
 * photoUrl, not an error.
 */
import { DOWNLOAD_URL_TTL_SECONDS } from '@sdb/contracts';
import type { SupabaseStoragePort } from './supabase-storage.js';

/**
 * Batched signed URLs for the DISTINCT non-null paths in `paths`.
 * Paths that fail to sign are absent or null in the returned map — callers
 * fall back to null via `map.get(path) ?? null`.
 */
export async function signPhotoPaths(
  storage: SupabaseStoragePort,
  paths: readonly (string | null)[],
): Promise<Map<string, string | null>> {
  const distinct = [
    ...new Set(paths.filter((path): path is string => path !== null)),
  ];
  if (distinct.length === 0) return new Map();
  try {
    return await storage.createSignedDownloadUrls(
      distinct,
      DOWNLOAD_URL_TTL_SECONDS,
    );
  } catch {
    return new Map(distinct.map((path) => [path, null]));
  }
}
