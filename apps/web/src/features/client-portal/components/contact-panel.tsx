/**
 * The PII gate, as the client experiences it (CLAUDE.md rule 4, 02 §11).
 *
 * The decision is made by the DATA, not the UI: gated fields arrive as SQL
 * NULL until the assignment reaches a PII-unlocked stage. This component
 * renders the locked panel whenever the gated fields are null and a contact
 * block from whatever is non-null once they unlock. A null gated field is
 * NEVER rendered — no empty labels, no blank rows.
 */
import { Linkedin, Lock, Mail, MessageCircle, Phone } from "lucide-react";
import { GATED_PII_FIELDS } from "@sdb/contracts";
import type { ClientVisibleAssignment } from "@sdb/contracts";
import { GATED_FIELD_LABELS } from "../labels";

/** True once the view has started emitting gated PII for this row. */
export function hasUnlockedPii(row: ClientVisibleAssignment): boolean {
  return GATED_PII_FIELDS.some((field) => row[field] !== null);
}

export function ContactPanel({ row }: { row: ClientVisibleAssignment }) {
  if (!hasUnlockedPii(row)) {
    return (
      <div className="rounded-md bg-surface-subtle px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Full contact details unlock once an interview is scheduled
        </p>
        <ul
          aria-label={`Details withheld for ${row.displayName}`}
          className="mt-2 flex flex-wrap gap-1.5"
        >
          {GATED_PII_FIELDS.map((field) => (
            <li key={field}>
              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                <Lock aria-hidden="true" className="h-3 w-3" />
                {GATED_FIELD_LABELS[field]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const fullName =
    row.firstName !== null || row.lastName !== null
      ? [row.firstName, row.lastName]
          .filter((part): part is string => part !== null)
          .join(" ")
      : null;

  return (
    <div className="rounded-md bg-success-subtle px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-tight text-success-text">
        Contact details
      </p>
      <dl className="mt-2 space-y-1.5 text-sm">
        {fullName !== null ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-xs text-neutral-500">Full name</dt>
            <dd className="font-medium text-neutral-800">{fullName}</dd>
          </div>
        ) : null}
        {row.email !== null ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Email</dt>
            <Mail aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
            <dd>
              <a
                href={`mailto:${row.email}`}
                className="text-brand-blue hover:underline"
              >
                {row.email}
              </a>
            </dd>
          </div>
        ) : null}
        {row.phone !== null ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Phone</dt>
            <Phone aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
            <dd>
              <a
                href={`tel:${row.phone}`}
                className="text-brand-blue hover:underline"
              >
                {row.phone}
              </a>
            </dd>
          </div>
        ) : null}
        {row.whatsapp !== null ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">WhatsApp</dt>
            <MessageCircle
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-neutral-500"
            />
            <dd className="text-neutral-800">
              WhatsApp: <span className="font-medium">{row.whatsapp}</span>
            </dd>
          </div>
        ) : null}
        {row.linkedinUrl !== null ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">LinkedIn</dt>
            <Linkedin
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-neutral-500"
            />
            <dd>
              <a
                href={row.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-blue hover:underline"
              >
                LinkedIn profile
              </a>
            </dd>
          </div>
        ) : null}
        {row.currentEmployer !== null ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-xs text-neutral-500">Current employer</dt>
            <dd className="text-neutral-800">{row.currentEmployer}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
