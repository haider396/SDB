/**
 * Typed fetch wrapper for the SDB API (docs/04-API.md §1).
 *
 * - Prefixes VITE_API_BASE_URL + /api/v1
 * - Injects `Authorization: Bearer <supabase access token>` when a session exists
 * - Unwraps the `{ data }` / `{ data, meta }` success envelopes
 * - Normalises the `{ error }` envelope into a typed ApiError
 */
import type { ErrorCode } from "@sdb/contracts";
import { getAccessToken } from "@/lib/auth";

/** Client-side-only failure modes, in addition to the server's codes. */
export type ClientErrorCode = "NETWORK_ERROR" | "UNPARSEABLE_RESPONSE";

export class ApiError extends Error {
  readonly code: ErrorCode | ClientErrorCode;
  readonly details: Record<string, unknown> | null;
  readonly requestId: string | null;
  readonly status: number;

  constructor(args: {
    code: ErrorCode | ClientErrorCode;
    message: string;
    details?: Record<string, unknown> | null;
    requestId?: string | null;
    status: number;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.details = args.details ?? null;
    this.requestId = args.requestId ?? null;
    this.status = args.status;
  }
}

export interface CollectionMeta {
  count: number;
  nextCursor: string | null;
}

export interface Collection<T> {
  data: T[];
  meta: CollectionMeta;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
    requestId?: string | null;
  };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function baseUrl(): string {
  return `${import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")}/api/v1`;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: unknown }).error !== null
  );
}

async function request(path: string, options: RequestOptions): Promise<unknown> {
  const url = new URL(`${baseUrl()}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers({ Accept: "application/json" });
  const token = await getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    throw new ApiError({
      code: "NETWORK_ERROR",
      message:
        cause instanceof Error && cause.name === "AbortError"
          ? "The request was cancelled."
          : "Could not reach the server. Check your connection and try again.",
      status: 0,
    });
  }

  if (response.status === 204) return undefined;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError({
      code: "UNPARSEABLE_RESPONSE",
      message: "The server returned an unreadable response.",
      status: response.status,
    });
  }

  if (!response.ok) {
    if (isErrorEnvelope(payload)) {
      throw new ApiError({
        // The server is the authority on codes; unknown strings still surface.
        code: payload.error.code as ErrorCode,
        message: payload.error.message,
        details: payload.error.details ?? null,
        requestId: payload.error.requestId ?? null,
        status: response.status,
      });
    }
    throw new ApiError({
      code: "UNPARSEABLE_RESPONSE",
      message: `Request failed with status ${response.status}.`,
      status: response.status,
    });
  }

  return payload;
}

/** Fetch a single resource; unwraps the `{ data }` envelope. */
export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const payload = await request(path, options);
  return (payload as { data: T }).data;
}

/** Fetch a collection; returns `{ data, meta }` (04-API.md §1.1). */
export async function apiFetchCollection<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Collection<T>> {
  const payload = await request(path, options);
  return payload as Collection<T>;
}
