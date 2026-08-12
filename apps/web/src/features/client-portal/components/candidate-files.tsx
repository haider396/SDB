/**
 * Client-visible candidate files (04 §8.1): every access fetches a fresh
 * signed URL (300 s TTL — never cached, never embedded at render time).
 * Documents open in a new tab; audio/video files toggle an inline player
 * fed by a just-fetched signed URL.
 */
import { Download, FileText, Loader2, Play } from "lucide-react";
import { useState } from "react";
import type { ClientVisibleFileRef } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { fetchDownloadUrl } from "@/features/candidates/api";
import { FILE_TYPE_LABELS, formatBytes } from "@/features/candidates/labels";

function isPlayable(file: ClientVisibleFileRef): "audio" | "video" | null {
  if (file.mimeType.startsWith("audio/")) return "audio";
  if (file.mimeType.startsWith("video/")) return "video";
  return null;
}

function FileRow({ file }: { file: ClientVisibleFileRef }) {
  const [isFetching, setIsFetching] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = isPlayable(file);

  const open = async () => {
    setError(null);
    setIsFetching(true);
    try {
      const { url } = await fetchDownloadUrl(file.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not fetch the download link. Please try again.",
      );
    } finally {
      setIsFetching(false);
    }
  };

  const play = async () => {
    setError(null);
    if (playerUrl !== null) {
      setPlayerUrl(null);
      return;
    }
    setIsFetching(true);
    try {
      const { url } = await fetchDownloadUrl(file.id);
      setPlayerUrl(url);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load this media file. Please try again.",
      );
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <li className="space-y-2">
      <div className="flex items-center gap-2">
        <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-neutral-800">
            {file.originalFilename}
          </p>
          <p className="text-xs text-neutral-500">
            {FILE_TYPE_LABELS[file.fileType]} · {formatBytes(file.sizeBytes)}
          </p>
        </div>
        {kind !== null ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void play()}
            disabled={isFetching}
            aria-expanded={playerUrl !== null}
          >
            {isFetching ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {playerUrl !== null ? "Hide player" : "Play"}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void open()}
          disabled={isFetching}
        >
          {isFetching && kind === null ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Download aria-hidden="true" />
          )}
          Download
        </Button>
      </div>
      {playerUrl !== null && kind === "audio" ? (
        <audio
          controls
          src={playerUrl}
          className="w-full"
          aria-label={`Audio player for ${file.originalFilename}`}
        />
      ) : null}
      {playerUrl !== null && kind === "video" ? (
        <video
          controls
          src={playerUrl}
          className="w-full rounded-md"
          aria-label={`Video player for ${file.originalFilename}`}
        />
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function CandidateFiles({
  files,
  candidateName,
}: {
  files: ClientVisibleFileRef[];
  candidateName: string;
}) {
  if (files.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-tight text-neutral-500">
        Files
      </p>
      <ul
        aria-label={`Files for ${candidateName}`}
        className="mt-2 space-y-3"
      >
        {files.map((file) => (
          <FileRow key={file.id} file={file} />
        ))}
      </ul>
    </div>
  );
}
