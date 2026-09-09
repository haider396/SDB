/**
 * The browser build's required configuration, checked once at import.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Vite inlines `import.meta.env.VITE_*` at BUILD time. A variable missing from
 * the build environment does not fail the build — it becomes `undefined`, and
 * the first code to touch it dies at runtime, far from the cause.
 *
 * That is not theoretical. `baseUrl()` read `VITE_API_BASE_URL.replace(...)`
 * directly, so a build without it threw inside the first fetch, the query
 * failed, and the public form rendered
 *
 *     "This form is not available — the link may have expired"
 *
 * to the candidate. A deployment misconfiguration wearing the costume of a
 * deleted form: nothing in that message points at the real problem, and the
 * candidate can do nothing about it. It cost a CI run to diagnose, and it would
 * have cost far more coming from a real applicant.
 *
 * `apps/api/src/lib/env.ts` has always done this properly — it validates at
 * boot and exits naming every missing key (AC-NFR-05). This is the browser's
 * equivalent: fail immediately, in one place, saying exactly what is missing.
 *
 * ── Why the values are read lazily ─────────────────────────────────────────
 * Validation runs once, at import, so a misconfigured build fails loudly and
 * early. The accessors below then re-read `import.meta.env` on each use rather
 * than closing over a snapshot. In a real build the two are identical — Vite
 * has already inlined literals — but a captured snapshot would silently ignore
 * `vi.stubEnv`, which is how tests point the client at a fake host.
 */

const REQUIRED = [
  "VITE_API_BASE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
] as const;

type RequiredKey = (typeof REQUIRED)[number];

function raw(key: RequiredKey): string | undefined {
  return (import.meta.env as unknown as Record<string, string | undefined>)[key];
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Throws naming every missing key, rather than one at a time. */
function assertConfigured(): void {
  const missing = REQUIRED.filter((key) => !present(raw(key)));
  if (missing.length === 0) return;
  throw new Error(
    `Missing build configuration: ${missing.join(", ")}. ` +
      `Vite inlines these at build time, so set them in the build environment ` +
      `(Vercel project settings, or apps/web/.env.local locally) and rebuild — ` +
      `setting them after a build has no effect on that build.`,
  );
}

assertConfigured();

function get(key: RequiredKey): string {
  const value = raw(key);
  if (!present(value)) {
    throw new Error(`Missing build configuration: ${key}.`);
  }
  return value;
}

export const env = {
  get VITE_API_BASE_URL(): string {
    return get("VITE_API_BASE_URL");
  },
  get VITE_SUPABASE_URL(): string {
    return get("VITE_SUPABASE_URL");
  },
  get VITE_SUPABASE_ANON_KEY(): string {
    return get("VITE_SUPABASE_ANON_KEY");
  },
};

/** The API root, with any trailing slashes removed. */
export function apiBaseUrl(): string {
  return `${env.VITE_API_BASE_URL.replace(/\/+$/, "")}/api/v1`;
}
