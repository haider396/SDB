/**
 * Timezone plumbing for the Schedule-interview dialog (NFR-11).
 *
 * The admin types a WALL time and picks the IANA zone that wall time is in
 * (defaulting to their own). The API stores an instant (`scheduledAt`, ISO
 * with offset) plus the zone label verbatim, so the wall time must be
 * converted from the chosen zone to UTC here. No timezone library exists in
 * this app; the conversion inverts `Intl.DateTimeFormat` — format a guess in
 * the target zone, measure the error, correct (twice, for DST edges).
 */

/** The viewer's IANA zone — the dialog's default. */
export function viewerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** IANA zone options for the select: the full list when available. */
export function timezoneOptions(): string[] {
  const viewer = viewerTimezone();
  if (typeof Intl.supportedValuesOf === "function") {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes(viewer) ? zones : [viewer, ...zones];
  }
  return [viewer];
}

/** What `wallTimeInZone` reads back from Intl for a given instant. */
function wallTimeAsUtcMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): number => {
    const part = parts.find((entry) => entry.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  // Intl reports midnight as 24 with hour12: false + 2-digit in some engines.
  const hour = get("hour") % 24;
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
}

/**
 * `datetime-local` value (yyyy-MM-ddTHH:mm) in `timeZone` → ISO-8601 UTC
 * instant. Two correction passes cover DST-transition edges; non-existent
 * wall times (spring-forward gap) resolve to the closest valid instant.
 */
export function zonedWallTimeToIso(wall: string, timeZone: string): string {
  const target = Date.parse(`${wall}:00Z`);
  if (Number.isNaN(target)) {
    throw new Error(`Not a datetime-local value: ${wall}`);
  }
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const error = wallTimeAsUtcMs(new Date(guess), timeZone) - target;
    if (error === 0) break;
    guess -= error;
  }
  return new Date(guess).toISOString();
}

/** "20 Aug 2026, 14:30" — an instant rendered in the VIEWER's zone. */
export function formatInViewerTimezone(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: viewerTimezone(),
  }).format(new Date(iso));
}
