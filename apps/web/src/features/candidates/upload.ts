/**
 * Candidate file upload flow (docs/04-API.md §8.1, 06 §6):
 *
 *   1. client-side validation against the NFR constants (type + size)
 *   2. POST /candidates/:id/files/upload-url → { fileId, uploadUrl, token }
 *   3. PUT the bytes straight to the signed Supabase Storage URL (XHR, so we
 *      get real upload progress — fetch cannot report it)
 *   4. POST /candidates/:id/files/:fileId/confirm → completed row
 *
 * If step 3 or 4 fails, the pending row is rolled back with a best-effort
 * DELETE so the file list never accumulates phantom "pending" entries.
 */
import type { CandidateFile, CandidateFileType, FileUploadUrlResponse } from "@sdb/contracts";
import { ACCEPTED_UPLOAD_MIME_TYPES, MAX_FILE_SIZE_MB } from "@sdb/contracts";
import { apiFetch, apiFetchEnvelope } from "@/lib/api-client";

export interface UploadProgress {
  loaded: number;
  total: number;
}

/** Returns a user-facing error, or null when the file is acceptable. */
export function validateUploadFile(file: File): string | null {
  if (!(ACCEPTED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "This file type is not accepted. Use PDF, DOCX, PNG, JPEG, WebP, MP4, WebM, MP3, or M4A.";
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return `Files must be ${MAX_FILE_SIZE_MB} MB or smaller.`;
  }
  if (file.size === 0) {
    return "This file is empty.";
  }
  return null;
}

/** PUT the bytes to the signed URL. Exposed for the test harness. */
export function putToSignedUrl(
  uploadUrl: string,
  token: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const target = new URL(uploadUrl);
    if (!target.searchParams.has("token")) {
      target.searchParams.set("token", token);
    }
    xhr.open("PUT", target.toString());
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (file.type !== "") xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.({ loaded: event.loaded, total: event.total });
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}.`));
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Upload failed — check your connection and try again.")),
    );
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.send(file);
  });
}

export async function uploadCandidateFile(args: {
  candidateId: string;
  file: File;
  fileType: CandidateFileType;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<CandidateFile> {
  const { candidateId, file, fileType, onProgress } = args;

  const grant = await apiFetch<FileUploadUrlResponse>(
    `/candidates/${candidateId}/files/upload-url`,
    {
      method: "POST",
      body: {
        fileType,
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      },
    },
  );

  try {
    await putToSignedUrl(grant.uploadUrl, grant.token, file, onProgress);
    return await apiFetch<CandidateFile>(
      `/candidates/${candidateId}/files/${grant.fileId}/confirm`,
      { method: "POST" },
    );
  } catch (cause) {
    // Roll the pending row back; the original failure is what surfaces.
    try {
      await apiFetchEnvelope<undefined>(
        `/candidates/${candidateId}/files/${grant.fileId}`,
        { method: "DELETE" },
      );
    } catch {
      // Best-effort cleanup only.
    }
    throw cause;
  }
}
