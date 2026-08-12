/**
 * Data hooks for the admin candidates workspace (docs/04-API.md §8, 01 §3 J4).
 *
 * Query keys:
 *   ["candidates", "list", filters]  — cursor-paginated list (infinite)
 *   ["candidates", "detail", id]     — full CandidateDetail
 *   ["candidates", "files", id]      — file list (refreshed after uploads)
 *   ["candidates", "options", kind]  — taxonomy option lists
 *
 * Consent is captured ONLY through POST /candidates/:id/consent — never via
 * PATCH — so consent_captured_at always reflects a deliberate action.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type {
  AccentStrength,
  Candidate,
  CandidateConsentBody,
  CandidateDetail,
  CandidateFile,
  CreateCandidateBody,
  DataCompleteness,
  FileDownloadUrlResponse,
  LanguageLevel,
  PoolStatus,
  PublicTaxonomy,
  RateUnit,
  UpdateCandidateBody,
  UpdateCandidateFileBody,
  VettingStatus,
} from "@sdb/contracts";
import {
  apiFetch,
  apiFetchCollection,
  apiFetchEnvelope,
  type Collection,
} from "@/lib/api-client";

export interface CandidateListFilters {
  search?: string;
  roleCategoryId?: string;
  country?: string;
  englishSpokenLevel?: LanguageLevel;
  maxAccentStrength?: AccentStrength;
  poolStatus?: PoolStatus;
  vettingStatus?: VettingStatus;
  availableFrom?: string;
  rateMax?: number;
  rateUnit?: RateUnit;
  /** ALL-semantics — candidates must have every listed tool (04 §8). */
  toolIds?: string[];
  dataCompleteness?: DataCompleteness;
}

export const candidateKeys = {
  root: ["candidates"] as const,
  list: (filters: CandidateListFilters) =>
    ["candidates", "list", filters] as const,
  detail: (id: string) => ["candidates", "detail", id] as const,
  files: (id: string) => ["candidates", "files", id] as const,
  options: (kind: string) => ["candidates", "options", kind] as const,
};

const PAGE_SIZE = 25;

export function useCandidates(
  filters: CandidateListFilters,
): UseInfiniteQueryResult<InfiniteData<Collection<Candidate>>, Error> {
  return useInfiniteQuery({
    queryKey: candidateKeys.list(filters),
    queryFn: ({ pageParam }) =>
      apiFetchCollection<Candidate>("/candidates", {
        query: {
          search: filters.search,
          roleCategoryId: filters.roleCategoryId,
          country: filters.country,
          englishSpokenLevel: filters.englishSpokenLevel,
          maxAccentStrength: filters.maxAccentStrength,
          poolStatus: filters.poolStatus,
          vettingStatus: filters.vettingStatus,
          availableFrom: filters.availableFrom,
          rateMax: filters.rateMax,
          rateUnit: filters.rateUnit,
          toolIds:
            filters.toolIds !== undefined && filters.toolIds.length > 0
              ? filters.toolIds.join(",")
              : undefined,
          dataCompleteness: filters.dataCompleteness,
          limit: PAGE_SIZE,
          cursor: pageParam,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  });
}

export function useCandidate(id: string) {
  return useQuery<CandidateDetail>({
    queryKey: candidateKeys.detail(id),
    queryFn: () => apiFetch<CandidateDetail>(`/candidates/${id}`),
  });
}

function useInvalidateCandidate() {
  const queryClient = useQueryClient();
  return (id: string) => {
    void queryClient.invalidateQueries({ queryKey: candidateKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: ["candidates", "list"] });
  };
}

export function useCreateCandidate() {
  const queryClient = useQueryClient();
  return useMutation<Candidate, unknown, CreateCandidateBody>({
    mutationFn: (body) =>
      apiFetch<Candidate>("/candidates", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["candidates", "list"] });
    },
  });
}

/**
 * PATCH returns the bare Candidate row; the detail cache holds a
 * CandidateDetail, so merge the scalars over the existing child collections.
 */
export function useUpdateCandidate() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCandidate();
  return useMutation<
    Candidate,
    unknown,
    { id: string; body: UpdateCandidateBody }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<Candidate>(`/candidates/${id}`, { method: "PATCH", body }),
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData<CandidateDetail>(
        candidateKeys.detail(id),
        (previous) =>
          previous === undefined ? previous : { ...previous, ...updated },
      );
      invalidate(id);
    },
  });
}

export function useArchiveCandidate() {
  const invalidate = useInvalidateCandidate();
  return useMutation<Candidate, unknown, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<Candidate>(`/candidates/${id}/archive`, { method: "POST" }),
    onSuccess: (_updated, { id }) => invalidate(id),
  });
}

/**
 * Consent capture — dedicated endpoint, applied optimistically with rollback
 * (05 §4.5). Never PATCH for consent.
 */
export function useCaptureConsent(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCandidate();
  return useMutation<
    Candidate,
    unknown,
    CandidateConsentBody,
    { previous: CandidateDetail | undefined }
  >({
    mutationFn: (body) =>
      apiFetch<Candidate>(`/candidates/${id}/consent`, {
        method: "POST",
        body,
      }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: candidateKeys.detail(id) });
      const previous = queryClient.getQueryData<CandidateDetail>(
        candidateKeys.detail(id),
      );
      if (previous !== undefined) {
        queryClient.setQueryData<CandidateDetail>(candidateKeys.detail(id), {
          ...previous,
          hasConsentToShareProfile: body.hasConsentToShareProfile,
          consentSource: body.consentSource,
        });
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(candidateKeys.detail(id), context.previous);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<CandidateDetail>(
        candidateKeys.detail(id),
        (previous) =>
          previous === undefined ? previous : { ...previous, ...updated },
      );
      invalidate(id);
    },
  });
}

/** Pool status quick toggle — optimistic with rollback (05 §4.5). */
export function usePoolStatus(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCandidate();
  return useMutation<
    Candidate,
    unknown,
    PoolStatus,
    { previous: CandidateDetail | undefined }
  >({
    mutationFn: (poolStatus) =>
      apiFetch<Candidate>(`/candidates/${id}`, {
        method: "PATCH",
        body: { poolStatus },
      }),
    onMutate: async (poolStatus) => {
      await queryClient.cancelQueries({ queryKey: candidateKeys.detail(id) });
      const previous = queryClient.getQueryData<CandidateDetail>(
        candidateKeys.detail(id),
      );
      if (previous !== undefined) {
        queryClient.setQueryData<CandidateDetail>(candidateKeys.detail(id), {
          ...previous,
          poolStatus,
        });
      }
      return { previous };
    },
    onError: (_error, _status, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(candidateKeys.detail(id), context.previous);
      }
    },
    onSuccess: (_updated, _status) => invalidate(id),
  });
}

// ---------------------------------------------------------------------------
// Child collections — one generic write hook; every mutation invalidates the
// detail (collections are served inside GET /candidates/:id).
// ---------------------------------------------------------------------------

export interface ChildWriteArgs {
  /** Path under /candidates/:id, e.g. "languages" or "languages/<entryId>". */
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

export function useChildWrite(candidateId: string) {
  const invalidate = useInvalidateCandidate();
  return useMutation<unknown, unknown, ChildWriteArgs>({
    mutationFn: ({ path, method, body }) =>
      apiFetchEnvelope<unknown>(`/candidates/${candidateId}/${path}`, {
        method,
        body,
      }),
    onSuccess: () => invalidate(candidateId),
  });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function useCandidateFiles(id: string) {
  return useQuery<CandidateFile[]>({
    queryKey: candidateKeys.files(id),
    queryFn: async () => {
      const { data } = await apiFetchCollection<CandidateFile>(
        `/candidates/${id}/files`,
      );
      return data;
    },
  });
}

export function useInvalidateFiles() {
  const queryClient = useQueryClient();
  return (id: string) => {
    void queryClient.invalidateQueries({ queryKey: candidateKeys.files(id) });
    void queryClient.invalidateQueries({ queryKey: candidateKeys.detail(id) });
  };
}

export function useUpdateFile(candidateId: string) {
  const queryClient = useQueryClient();
  const invalidateFiles = useInvalidateFiles();
  return useMutation<
    CandidateFile,
    unknown,
    { fileId: string; body: UpdateCandidateFileBody },
    { previous: CandidateFile[] | undefined }
  >({
    mutationFn: ({ fileId, body }) =>
      apiFetch<CandidateFile>(`/candidates/${candidateId}/files/${fileId}`, {
        method: "PATCH",
        body,
      }),
    // Optimistic client-visible toggle with rollback (05 §4.5).
    onMutate: async ({ fileId, body }) => {
      await queryClient.cancelQueries({
        queryKey: candidateKeys.files(candidateId),
      });
      const previous = queryClient.getQueryData<CandidateFile[]>(
        candidateKeys.files(candidateId),
      );
      if (previous !== undefined) {
        queryClient.setQueryData<CandidateFile[]>(
          candidateKeys.files(candidateId),
          previous.map((file) =>
            file.id === fileId ? { ...file, ...body } : file,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _args, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          candidateKeys.files(candidateId),
          context.previous,
        );
      }
    },
    onSuccess: () => invalidateFiles(candidateId),
  });
}

export function useDeleteFile(candidateId: string) {
  const invalidateFiles = useInvalidateFiles();
  return useMutation<void, unknown, { fileId: string }>({
    mutationFn: async ({ fileId }) => {
      await apiFetchEnvelope<undefined>(
        `/candidates/${candidateId}/files/${fileId}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => invalidateFiles(candidateId),
  });
}

/** Signed download URL — valid 300 s (06 §6); fetch fresh on every click. */
export function fetchDownloadUrl(
  fileId: string,
): Promise<FileDownloadUrlResponse> {
  return apiFetch<FileDownloadUrlResponse>(`/files/${fileId}/download-url`);
}

// ---------------------------------------------------------------------------
// Option lists — taxonomy (04 §3/§5). /tools, /skills, and /disqualifiers
// are the documented taxonomy-management reads (04 §5).
// ---------------------------------------------------------------------------

export interface RoleCategoryOption {
  id: string;
  label: string;
  engineLabel: string;
  departmentLabel: string;
}

export interface EngineOption {
  id: string;
  label: string;
}

export function useTaxonomyOptions() {
  return useQuery<{
    engines: EngineOption[];
    roleCategories: RoleCategoryOption[];
    roleCategoryLabelById: Record<string, string>;
  }>({
    queryKey: candidateKeys.options("taxonomy"),
    queryFn: async () => {
      const taxonomy = await apiFetch<PublicTaxonomy>("/taxonomy/public");
      const engines: EngineOption[] = taxonomy.engines.map((engine) => ({
        id: engine.id,
        label: engine.label,
      }));
      const roleCategories: RoleCategoryOption[] = taxonomy.engines.flatMap(
        (engine) =>
          engine.departments.flatMap((department) =>
            department.roleCategories.map((category) => ({
              id: category.id,
              label: category.label,
              engineLabel: engine.label,
              departmentLabel: department.label,
            })),
          ),
      );
      const roleCategoryLabelById: Record<string, string> = {};
      for (const category of roleCategories) {
        roleCategoryLabelById[category.id] = category.label;
      }
      return { engines, roleCategories, roleCategoryLabelById };
    },
    staleTime: 5 * 60_000,
  });
}

export interface ToolOption {
  id: string;
  name: string;
  category: string | null;
  isActive: boolean;
}

function parseToolRows(rows: unknown[]): ToolOption[] {
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") {
      return [];
    }
    return [
      {
        id: record.id,
        name: record.name,
        category: typeof record.category === "string" ? record.category : null,
        isActive: record.isActive !== false,
      },
    ];
  });
}

export function useToolOptions() {
  return useQuery<ToolOption[]>({
    queryKey: candidateKeys.options("tools"),
    queryFn: async () => {
      const { data } = await apiFetchCollection<unknown>("/tools");
      return parseToolRows(data).filter((tool) => tool.isActive);
    },
    staleTime: 5 * 60_000,
  });
}

export function useSkillOptions() {
  return useQuery<ToolOption[]>({
    queryKey: candidateKeys.options("skills"),
    queryFn: async () => {
      const { data } = await apiFetchCollection<unknown>("/skills");
      return parseToolRows(data).filter((skill) => skill.isActive);
    },
    staleTime: 5 * 60_000,
  });
}

export interface DisqualifierOption {
  id: string;
  key: string;
  label: string;
  roleCategoryId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export function useDisqualifierOptions() {
  return useQuery<DisqualifierOption[]>({
    queryKey: candidateKeys.options("disqualifiers"),
    queryFn: async () => {
      const { data } = await apiFetchCollection<unknown>("/disqualifiers");
      return data
        .flatMap((row): DisqualifierOption[] => {
          if (typeof row !== "object" || row === null) return [];
          const record = row as Record<string, unknown>;
          if (
            typeof record.id !== "string" ||
            typeof record.label !== "string"
          ) {
            return [];
          }
          return [
            {
              id: record.id,
              key: typeof record.key === "string" ? record.key : record.id,
              label: record.label,
              roleCategoryId:
                typeof record.roleCategoryId === "string"
                  ? record.roleCategoryId
                  : null,
              isActive: record.isActive !== false,
              sortOrder:
                typeof record.sortOrder === "number" ? record.sortOrder : 0,
            },
          ];
        })
        .filter((disqualifier) => disqualifier.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
    },
    staleTime: 5 * 60_000,
  });
}
