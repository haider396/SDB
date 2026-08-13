/**
 * Files card (04 §8.1): list with type badge, client-visible toggle
 * (optimistic PATCH), fresh signed download URLs (300 s, 06 §6), typed-name
 * delete, and the upload flow — validate → upload-url → direct PUT with
 * progress → confirm → refresh. Upload success reports inline (next to the
 * control that caused it), not as a toast. CV rows can be promoted to the
 * profile's primary CV; photo rows can become the profile photo — a photo
 * upload fills an empty photoPath automatically.
 */
import { Download, FileText, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { CandidateDetail, CandidateFile, CandidateFileType } from "@sdb/contracts";
import {
  ACCEPTED_UPLOAD_MIME_TYPES,
  CandidateFileTypeSchema,
  MAX_FILE_SIZE_MB,
} from "@sdb/contracts";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api-client";
import {
  fetchDownloadUrl,
  useCandidateFiles,
  useDeleteFile,
  useInvalidateFiles,
  useUpdateCandidate,
  useUpdateFile,
} from "../api";
import { FILE_TYPE_LABELS, formatBytes } from "../labels";
import {
  uploadCandidateFile,
  validateUploadFile,
  type UploadProgress,
} from "../upload";

export function FilesCard({ candidate }: { candidate: CandidateDetail }) {
  const filesQuery = useCandidateFiles(candidate.id);
  const updateFile = useUpdateFile(candidate.id);
  const deleteFile = useDeleteFile(candidate.id);
  const updateCandidate = useUpdateCandidate();
  const invalidateFiles = useInvalidateFiles();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileType, setFileType] = useState<CandidateFileType>("cv");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deleting, setDeleting] = useState<CandidateFile | null>(null);

  const startUpload = async (file: File) => {
    const validationError = validateUploadFile(file);
    if (validationError !== null) {
      setUploadError(validationError);
      return;
    }
    setUploadError(null);
    setUploadSuccess(null);
    setIsUploading(true);
    setProgress({ loaded: 0, total: file.size });
    try {
      const uploaded = await uploadCandidateFile({
        candidateId: candidate.id,
        file,
        fileType,
        onProgress: setProgress,
      });
      // A photo upload fills an empty profile photo automatically.
      let becameProfilePhoto = false;
      if (fileType === "photo" && candidate.photoPath === null) {
        await updateCandidate.mutateAsync({
          id: candidate.id,
          body: { photoPath: uploaded.storagePath },
        });
        becameProfilePhoto = true;
      }
      invalidateFiles(candidate.id);
      setUploadSuccess(
        becameProfilePhoto
          ? `${file.name} uploaded and set as the profile photo.`
          : `${file.name} uploaded.`,
      );
    } catch (cause) {
      setUploadError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "The upload failed. Please try again.",
      );
    } finally {
      setIsUploading(false);
      setProgress(null);
      if (fileInputRef.current !== null) fileInputRef.current.value = "";
    }
  };

  const setPrimaryCv = (file: CandidateFile) => {
    updateCandidate.mutate(
      { id: candidate.id, body: { cvPrimaryFileId: file.id } },
      {
        onError: (cause) => {
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : "Could not set the primary CV.",
          );
        },
      },
    );
  };

  const makeProfilePhoto = (file: CandidateFile) => {
    updateCandidate.mutate(
      { id: candidate.id, body: { photoPath: file.storagePath } },
      {
        onError: (cause) => {
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : "Could not set the profile photo.",
          );
        },
      },
    );
  };

  const download = async (file: CandidateFile) => {
    try {
      const { url } = await fetchDownloadUrl(file.id);
      window.open(url, "_blank", "noopener");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : "Could not fetch a download link.",
      );
    }
  };

  const percent =
    progress !== null && progress.total > 0
      ? Math.round((progress.loaded / progress.total) * 100)
      : 0;

  const files = filesQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ----- Upload ----- */}
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="upload-file-type">File type</Label>
            <NativeSelect
              id="upload-file-type"
              value={fileType}
              onChange={(event) =>
                setFileType(event.target.value as CandidateFileType)
              }
              disabled={isUploading}
            >
              {CandidateFileTypeSchema.options.map((type) => (
                <option key={type} value={type}>
                  {FILE_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
            {fileType === "cv" ? (
              <p className="text-xs text-neutral-500">
                CV uploads can be set as the profile's primary CV.
              </p>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            id="upload-file-input"
            type="file"
            className="sr-only"
            accept={ACCEPTED_UPLOAD_MIME_TYPES.join(",")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void startUpload(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud aria-hidden="true" />
            {isUploading ? "Uploading…" : "Upload file"}
          </Button>
          <p className="text-xs text-neutral-500">
            PDF, DOCX, images, video, or audio · max {MAX_FILE_SIZE_MB} MB.
          </p>
          {isUploading && progress !== null ? (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="Upload progress"
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle"
            >
              <div
                className="h-full rounded-full bg-gradient-progress transition-all duration-fast"
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
          {uploadError !== null ? (
            <p role="alert" className="text-xs text-danger-text">
              {uploadError}
            </p>
          ) : null}
          {uploadSuccess !== null ? (
            <p aria-live="polite" className="text-xs text-success-text">
              {uploadSuccess}
            </p>
          ) : null}
        </div>

        {/* ----- List ----- */}
        {filesQuery.isPending ? (
          <LoadingSkeleton variant="list" rows={2} label="Loading files…" />
        ) : filesQuery.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            Files could not be loaded.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void filesQuery.refetch()}
            >
              Retry
            </button>
          </p>
        ) : files.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No files yet. Upload the CV, photo, and media samples here.
          </p>
        ) : (
          <ul className="divide-y divide-border-default">
            {files.map((file) => (
              <li key={file.id} className="space-y-1 py-2">
                <div className="flex items-center gap-2">
                  <FileText
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-neutral-400"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800"
                    title={file.originalFilename}
                  >
                    {file.originalFilename}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Download ${file.originalFilename}`}
                    onClick={() => void download(file)}
                  >
                    <Download aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Delete ${file.originalFilename}`}
                    onClick={() => setDeleting(file)}
                  >
                    <Trash2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-danger-text"
                    />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-2xs font-medium text-neutral-600">
                    {FILE_TYPE_LABELS[file.fileType]}
                  </span>
                  {candidate.cvPrimaryFileId === file.id ? (
                    <span className="rounded-full bg-brand-blue-subtle px-2 py-0.5 text-2xs font-medium text-brand-blue">
                      Primary CV
                    </span>
                  ) : null}
                  {file.virusScanStatus === "pending" ? (
                    <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-2xs font-medium text-warning-text">
                      Pending
                    </span>
                  ) : null}
                  <span className="text-xs text-neutral-500">
                    {formatBytes(file.sizeBytes)}
                  </span>
                  <label
                    htmlFor={`file-visible-${file.id}`}
                    className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-neutral-800"
                  >
                    <input
                      id={`file-visible-${file.id}`}
                      type="checkbox"
                      checked={file.isClientVisible}
                      onChange={(event) =>
                        updateFile.mutate(
                          {
                            fileId: file.id,
                            body: { isClientVisible: event.target.checked },
                          },
                          {
                            onError: (cause) => {
                              toast.error(
                                cause instanceof ApiError
                                  ? cause.message
                                  : "Could not update visibility — rolled back.",
                              );
                            },
                          },
                        )
                      }
                      className="h-3.5 w-3.5 rounded-sm accent-brand-blue"
                    />
                    Client-visible
                  </label>
                </div>
                {file.fileType === "cv" &&
                candidate.cvPrimaryFileId !== file.id ? (
                  <div className="pl-6">
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-blue hover:underline disabled:opacity-50"
                      disabled={updateCandidate.isPending}
                      onClick={() => setPrimaryCv(file)}
                    >
                      Set as primary CV
                    </button>
                  </div>
                ) : null}
                {file.fileType === "photo" &&
                candidate.photoPath !== file.storagePath ? (
                  <div className="pl-6">
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-blue hover:underline disabled:opacity-50"
                      disabled={updateCandidate.isPending}
                      onClick={() => makeProfilePhoto(file)}
                    >
                      Use as profile photo
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <TypedConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.originalFilename ?? "file"}?`}
        description="The file is removed from storage and from any client-visible profile."
        confirmName={deleting?.originalFilename ?? ""}
        confirmLabel="Delete file"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (deleting === null) return;
          await deleteFile.mutateAsync({ fileId: deleting.id });
          setDeleting(null);
        }}
      />
    </Card>
  );
}
