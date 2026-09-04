/**
 * Documents step (T38).
 *
 * File uploads are explicitly in scope for the registration form (Haider,
 * 28 Aug): a candidate record without a CV is of little use, and this is a
 * primary intake path.
 *
 * Uploads happen immediately on selection rather than being deferred to
 * submit, so a slow connection does not turn the final button into a
 * multi-megabyte gamble. Each upload is staged against the registration
 * session and only attached to a candidate when the form is submitted.
 */
import { useRef, useState } from "react";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { validateUploadFile } from "@/features/candidates/upload";
import { uploadRegistrationFile } from "../api";
import {
  REGISTRATION_FILE_HINTS,
  REGISTRATION_FILE_LABELS,
  REGISTRATION_FILE_TYPES,
  type AttachedFile,
  type RegistrationFileType,
} from "../types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  files: AttachedFile[];
  onFilesChange: (files: AttachedFile[]) => void;
  /** Lazily creates the session on first upload. */
  ensureSession: () => Promise<string>;
}

export function DocumentsStep({ files, onFilesChange, ensureSession }: Props) {
  const [busyType, setBusyType] = useState<RegistrationFileType | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleSelect(
    fileType: RegistrationFileType,
    fileList: FileList | null,
  ) {
    const file = fileList?.[0];
    if (file === undefined) return;
    setError(null);

    const invalid = validateUploadFile(file);
    if (invalid !== null) {
      setError(invalid);
      return;
    }

    setBusyType(fileType);
    setProgress(0);
    try {
      const sessionId = await ensureSession();
      const { fileId } = await uploadRegistrationFile({
        sessionId,
        file,
        fileType,
        onProgress: ({ loaded, total }) =>
          setProgress(total === 0 ? 0 : Math.round((loaded / total) * 100)),
      });
      onFilesChange([
        // One file per type keeps the step simple; re-selecting replaces.
        ...files.filter((existing) => existing.fileType !== fileType),
        { fileId, fileType, filename: file.name, sizeBytes: file.size },
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That upload did not complete. Please try again.",
      );
    } finally {
      setBusyType(null);
      setProgress(0);
      const input = inputRefs.current[fileType];
      if (input !== null && input !== undefined) input.value = "";
    }
  }

  return (
    <div className="space-y-5">
      {error !== null ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {REGISTRATION_FILE_TYPES.map((fileType) => {
        const attached = files.find((file) => file.fileType === fileType);
        const inputId = `registration-file-${fileType}`;
        const isBusy = busyType === fileType;
        return (
          <div key={fileType} className="space-y-1.5">
            <Label htmlFor={inputId}>{REGISTRATION_FILE_LABELS[fileType]}</Label>
            <p className="text-xs text-neutral-500">
              {REGISTRATION_FILE_HINTS[fileType]}
            </p>

            {attached !== undefined ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-surface-subtle px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-brand-navy-ink">
                  {attached.filename}
                </span>
                <span className="text-xs tabular-nums text-neutral-500">
                  {formatBytes(attached.sizeBytes)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onFilesChange(
                      files.filter((file) => file.fileType !== fileType),
                    )
                  }
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </Button>
              </div>
            ) : null}

            <input
              id={inputId}
              ref={(element) => {
                inputRefs.current[fileType] = element;
              }}
              type="file"
              className="sr-only"
              disabled={isBusy}
              onChange={(event) => void handleSelect(fileType, event.target.files)}
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => inputRefs.current[fileType]?.click()}
              >
                {isBusy ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <FileUp aria-hidden="true" />
                )}
                {attached !== undefined ? "Replace" : "Choose file"}
              </Button>
              {isBusy ? (
                <span
                  className="text-xs tabular-nums text-neutral-500"
                  aria-live="polite"
                >
                  Uploading… {progress}%
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
