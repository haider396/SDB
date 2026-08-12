/**
 * file_upload → drop zone UI with type and size hints. Upload itself arrives
 * with candidate file handling in P3; the public intake renderer shows the
 * zone disabled with an explanatory sentence, and never blocks submission on
 * it (schema-builder treats file_upload as always optional in P1).
 */
import { UploadCloud } from "lucide-react";
import { GroupShell } from "./field-shell";
import type { FieldProps } from "./types";

function extensionsFrom(mimeTypes: readonly string[] | undefined): string | null {
  if (mimeTypes === undefined || mimeTypes.length === 0) return null;
  const names = mimeTypes
    .map((mime) => mime.split("/").pop() ?? mime)
    .map((part) => part.replace(/^vnd\..*\./, "").toUpperCase());
  return names.join(", ");
}

export function FileUploadField({ question, error }: FieldProps) {
  const accepted = extensionsFrom(question.validation.acceptedMimeTypes);
  const maxSize = question.validation.maxFileSizeMb;

  return (
    <GroupShell question={question} error={error}>
      <div
        aria-disabled="true"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-default bg-surface-subtle px-6 py-8 text-center opacity-70"
      >
        <UploadCloud aria-hidden="true" className="h-6 w-6 text-neutral-400" />
        <p className="text-sm font-medium text-neutral-600">
          File upload is not available on this form yet.
        </p>
        <p className="max-w-sm text-xs text-neutral-500">
          You can share files with your Staffing Done Better contact after
          submitting — this won’t hold up your request.
        </p>
        {accepted !== null || maxSize !== undefined ? (
          <p className="text-xs text-neutral-400">
            {accepted !== null ? `Accepted: ${accepted}` : null}
            {accepted !== null && maxSize !== undefined ? " · " : null}
            {maxSize !== undefined ? `Max ${maxSize} MB` : null}
          </p>
        ) : null}
      </div>
    </GroupShell>
  );
}
