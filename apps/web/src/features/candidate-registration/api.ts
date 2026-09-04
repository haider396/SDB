/**
 * Data hooks for the public candidate registration form (T38).
 *
 * Every call passes `auth: false` — the form is genuinely anonymous and must
 * never touch the Supabase client. That is the same discipline AC-IF-17 pins
 * on the intake form: nothing is written to localStorage or sessionStorage,
 * because a public form may well be completed on a shared machine.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CandidateRegistrationFormResponseSchema,
  type CandidateRegistration,
  type CandidateRegistrationFormResponse,
  type CandidateRegistrationResponse,
  type RegistrationSessionResponse,
  type RegistrationUploadUrlResponse,
} from "@sdb/contracts";
import { apiFetch } from "@/lib/api-client";
import {
  putToSignedUrl,
  type UploadProgress,
} from "@/features/candidates/upload";
import type { RegistrationFileType } from "./types";

export function useRegistrationForm() {
  return useQuery<CandidateRegistrationFormResponse>({
    queryKey: ["candidate-registration-form"],
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/candidate-registration-form", {
        auth: false,
      });
      return CandidateRegistrationFormResponseSchema.parse(payload);
    },
    staleTime: 60_000,
  });
}

/**
 * Starts the session that anchors mid-form uploads. Called once, lazily — a
 * visitor who never attaches a file and never submits costs us nothing.
 */
export async function startRegistrationSession(): Promise<RegistrationSessionResponse> {
  return apiFetch<RegistrationSessionResponse>(
    "/candidate-registrations/session",
    { method: "POST", auth: false },
  );
}

/**
 * Upload one document against the session: grant → PUT to storage → confirm.
 * Mirrors the admin flow (06 §6) and reuses its signed-URL PUT helper, so
 * upload progress behaves identically in both places.
 */
export async function uploadRegistrationFile(args: {
  sessionId: string;
  file: File;
  fileType: RegistrationFileType;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<{ fileId: string }> {
  const { sessionId, file, fileType, onProgress } = args;

  const grant = await apiFetch<RegistrationUploadUrlResponse>(
    `/candidate-registrations/${sessionId}/upload-url`,
    {
      method: "POST",
      auth: false,
      body: {
        fileType,
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      },
    },
  );

  await putToSignedUrl(grant.uploadUrl, grant.token, file, onProgress);
  await apiFetch<{ confirmed: true }>(
    `/candidate-registrations/${sessionId}/files/${grant.fileId}/confirm`,
    { method: "POST", auth: false },
  );
  return { fileId: grant.fileId };
}

export function useSubmitRegistration() {
  return useMutation<CandidateRegistrationResponse, unknown, CandidateRegistration>(
    {
      mutationFn: (body) =>
        apiFetch<CandidateRegistrationResponse>("/candidate-registrations", {
          method: "POST",
          auth: false,
          body,
        }),
    },
  );
}
