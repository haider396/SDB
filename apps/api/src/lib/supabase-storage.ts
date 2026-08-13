/**
 * Supabase Storage integration point (docs/06-BACKEND.md §6), same port
 * pattern as lib/supabase-admin.ts: services depend on `SupabaseStoragePort`
 * and tests stub it — no network in tests.
 *
 * The bucket (`SUPABASE_STORAGE_BUCKET_CANDIDATES`) is PRIVATE. Uploads and
 * downloads happen only via short-lived signed URLs; file bytes never pass
 * through the API except for webhook CV ingestion (uploadObject) and CV text
 * extraction (downloadObject), which are server-initiated.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env.js';
import { ApiError } from './errors.js';

export interface SignedUploadUrl {
  url: string;
  /** Pairs with the URL for supabase-js `uploadToSignedUrl`. */
  token: string;
}

export interface StorageObjectStat {
  sizeBytes: number;
  mimeType: string | null;
}

export interface SupabaseStoragePort {
  /** Signed upload URL for a direct browser → Storage upload (06 §6 step 1). */
  createSignedUploadUrl(path: string): Promise<SignedUploadUrl>;
  /** Signed download URL, valid `expiresInSeconds` (300 in production paths). */
  createSignedDownloadUrl(
    path: string,
    expiresInSeconds: number,
  ): Promise<string>;
  /**
   * Batched signed download URLs — ONE storage round-trip for many objects
   * (read-time photoUrl decoration, UX 1.4). Returns path → signed URL;
   * paths that could not be signed map to null. Never throws for individual
   * failures: read models must not 500 because a thumbnail failed to sign.
   */
  createSignedDownloadUrls(
    paths: string[],
    expiresInSeconds: number,
  ): Promise<Map<string, string | null>>;
  /** Remove an object. Idempotent: a missing object is a success. */
  removeObject(path: string): Promise<void>;
  /** Object metadata, or null when the object does not exist (confirm step). */
  statObject(path: string): Promise<StorageObjectStat | null>;
  /** Server-side store (webhook CV ingestion). */
  uploadObject(
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  /** Server-side fetch (CV text extraction). */
  downloadObject(path: string): Promise<Uint8Array>;
}

export function createSupabaseStorage(
  env: Pick<
    Env,
    | 'SUPABASE_URL'
    | 'SUPABASE_SERVICE_ROLE_KEY'
    | 'SUPABASE_STORAGE_BUCKET_CANDIDATES'
  >,
): SupabaseStoragePort {
  const client: SupabaseClient = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const bucket = () => client.storage.from(env.SUPABASE_STORAGE_BUCKET_CANDIDATES);

  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error !== null || data === null) {
        throw new ApiError('INTERNAL_ERROR', 'Could not create an upload URL.');
      }
      return { url: data.signedUrl, token: data.token };
    },

    async createSignedDownloadUrl(path, expiresInSeconds) {
      const { data, error } = await bucket().createSignedUrl(
        path,
        expiresInSeconds,
      );
      if (error !== null || data === null) {
        throw new ApiError('INTERNAL_ERROR', 'Could not create a download URL.');
      }
      return data.signedUrl;
    },

    async createSignedDownloadUrls(paths, expiresInSeconds) {
      const result = new Map<string, string | null>();
      if (paths.length === 0) return result;
      for (const path of paths) result.set(path, null);
      const { data, error } = await bucket().createSignedUrls(
        paths,
        expiresInSeconds,
      );
      if (error !== null || data === null) {
        // Batch-level failure degrades to all-null; the caller renders
        // without photos rather than failing the read.
        return result;
      }
      for (const entry of data) {
        if (entry.error === null && entry.path !== null) {
          result.set(entry.path, entry.signedUrl);
        }
      }
      return result;
    },

    async removeObject(path) {
      const { error } = await bucket().remove([path]);
      // Removing a missing object is not an error — deletion is idempotent.
      if (error !== null) {
        throw new ApiError('INTERNAL_ERROR', 'Could not remove the file.');
      }
    },

    async statObject(path) {
      // storage-js has no direct HEAD; list the parent prefix and match the
      // object name — metadata carries size and mimetype for real objects.
      const slash = path.lastIndexOf('/');
      const dir = slash === -1 ? '' : path.slice(0, slash);
      const name = slash === -1 ? path : path.slice(slash + 1);
      const { data, error } = await bucket().list(dir, {
        limit: 1,
        search: name,
      });
      if (error !== null || data === null) {
        throw new ApiError('INTERNAL_ERROR', 'Could not inspect the file.');
      }
      const entry = data.find((item) => item.name === name);
      if (entry === undefined) return null;
      const metadata = (entry.metadata ?? {}) as {
        size?: number;
        mimetype?: string;
      };
      return {
        sizeBytes: typeof metadata.size === 'number' ? metadata.size : 0,
        mimeType: typeof metadata.mimetype === 'string' ? metadata.mimetype : null,
      };
    },

    async uploadObject(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, {
        contentType,
        upsert: true,
      });
      if (error !== null) {
        throw new ApiError('INTERNAL_ERROR', 'Could not store the file.');
      }
    },

    async downloadObject(path) {
      const { data, error } = await bucket().download(path);
      if (error !== null || data === null) {
        throw new ApiError('INTERNAL_ERROR', 'Could not download the file.');
      }
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
