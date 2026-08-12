/**
 * GoHighLevel outbound webhook client (docs/06-BACKEND.md §4.1).
 *
 * One inbound-webhook URL per notification_event (`GHL_WEBHOOK_URL_<EVENT>`).
 * `dispatch` POSTs the standard payload to the event's URL with the private
 * integration token. The fetch implementation is injectable so tests run
 * against a recording mock instead of the network (AC-NT-01..03).
 *
 * The GHL_WEBHOOK_URL_* envs are optional at boot (P0–P6 never dial out);
 * the dispatcher asserts them at dispatch time — an unset URL is a normal
 * `failed` outcome with `last_error = 'webhook url not configured'`, never a
 * crash (06 §4.3: a notification failure never fails the user request).
 */
import type { NotificationEvent } from '@sdb/contracts';
import type { Env } from '../lib/env.js';

/** Structural subset of WHATWG fetch (Node 20's built-in undici fetch). */
export type GhlFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export type GhlDispatchResult =
  | { ok: true; httpStatus: number; responseBody: unknown }
  | {
      ok: false;
      error: string;
      httpStatus: number | null;
      responseBody: unknown | null;
    };

export interface GoHighLevelClient {
  /** The configured webhook URL for an event, or null when unset. */
  webhookUrlFor(event: NotificationEvent): string | null;
  /** POST `payload` to the event's webhook URL. Never throws. */
  dispatch(event: NotificationEvent, payload: unknown): Promise<GhlDispatchResult>;
}

export interface GoHighLevelClientOptions {
  /** Map of notification_event → inbound webhook URL (unset entries omitted). */
  webhookUrls: Partial<Record<NotificationEvent, string>>;
  privateIntegrationToken: string;
  locationId: string;
  /** Outbound request timeout; default 10 s. */
  timeoutMs?: number;
  /** Injectable fetch for tests; defaults to the global (undici) fetch. */
  fetchImpl?: GhlFetch;
}

/** Cap stored response bodies so a misbehaving endpoint cannot bloat rows. */
const MAX_STORED_RESPONSE_CHARS = 10_000;

export function webhookUrlsFromEnv(
  env: Env,
): Partial<Record<NotificationEvent, string>> {
  const urls: Partial<Record<NotificationEvent, string>> = {};
  const add = (event: NotificationEvent, url: string | undefined): void => {
    if (url !== undefined) urls[event] = url;
  };
  add('intake_submitted', env.GHL_WEBHOOK_URL_INTAKE_SUBMITTED);
  add('portal_invitation', env.GHL_WEBHOOK_URL_PORTAL_INVITATION);
  add(
    'principal_approval_requested',
    env.GHL_WEBHOOK_URL_PRINCIPAL_APPROVAL_REQUESTED,
  );
  add('candidates_presented', env.GHL_WEBHOOK_URL_CANDIDATES_PRESENTED);
  add('client_decision_recorded', env.GHL_WEBHOOK_URL_CLIENT_DECISION_RECORDED);
  add('interview_scheduled', env.GHL_WEBHOOK_URL_INTERVIEW_SCHEDULED);
  add(
    'requisition_status_changed',
    env.GHL_WEBHOOK_URL_REQUISITION_STATUS_CHANGED,
  );
  return urls;
}

/** Parse a response body for provider_response: JSON when possible. */
function parseResponseBody(text: string): unknown {
  const clipped =
    text.length > MAX_STORED_RESPONSE_CHARS
      ? text.slice(0, MAX_STORED_RESPONSE_CHARS)
      : text;
  try {
    return JSON.parse(clipped) as unknown;
  } catch {
    return clipped.length > 0 ? { raw: clipped } : null;
  }
}

export function createGoHighLevelClient(
  options: GoHighLevelClientOptions,
): GoHighLevelClient {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl: GhlFetch =
    options.fetchImpl ?? (globalThis.fetch as unknown as GhlFetch);

  return {
    webhookUrlFor(event) {
      return options.webhookUrls[event] ?? null;
    },

    async dispatch(event, payload) {
      const url = options.webhookUrls[event] ?? null;
      if (url === null) {
        return {
          ok: false,
          error: 'webhook url not configured',
          httpStatus: null,
          responseBody: null,
        };
      }
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.privateIntegrationToken}`,
            'content-type': 'application/json',
            // Location context for GHL-side routing/diagnostics (06 §3.1).
            'x-ghl-location-id': options.locationId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const responseBody = parseResponseBody(await response.text());
        if (response.status >= 200 && response.status < 300) {
          return { ok: true, httpStatus: response.status, responseBody };
        }
        return {
          ok: false,
          error: `GoHighLevel responded ${response.status}`,
          httpStatus: response.status,
          responseBody,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          httpStatus: null,
          responseBody: null,
        };
      }
    },
  };
}
