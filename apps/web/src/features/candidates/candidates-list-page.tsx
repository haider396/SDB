/**
 * /admin/candidates — the talent pool (01 §3 J4). Dense table (05 §4.1)
 * with the full 04 §8 filter set held in the URL so back-navigation
 * restores it. Admins see full PII here — this surface never feeds clients.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { FilterX, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  AccentStrength,
  Candidate,
  DataCompleteness,
  LanguageLevel,
  PoolStatus,
  RateUnit,
  VettingStatus,
} from "@sdb/contracts";
import {
  AccentStrengthSchema,
  LanguageLevelSchema,
  PoolStatusSchema,
  RateUnitSchema,
  VettingStatusSchema,
} from "@sdb/contracts";
import {
  DataTable,
  type DataTableColumnMeta,
} from "@/components/patterns/data-table";
import { MoneyFigure } from "@/components/patterns/money-figure";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { rateParts, SENIORITY_LABELS } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  CANDIDATE_PAGE_SIZE,
  useCandidates,
  useTaxonomyOptions,
  useToolOptions,
} from "./api";
import {
  ACCENT_LABELS,
  COUNTRY_NAMES,
  countryFlag,
  LANGUAGE_LEVEL_LABELS,
  POOL_STATUS_LABELS,
  VETTING_STATUS_LABELS,
} from "./labels";
import {
  DataCompletenessBadge,
  PoolStatusBadge,
  VettingStatusBadge,
} from "./components/badges";
import { MultiSelectCombobox } from "./components/multi-select-combobox";

function meta(value: DataTableColumnMeta): DataTableColumnMeta {
  return value;
}

function parseEnum<T extends string>(
  options: readonly T[],
  value: string | null,
): T | undefined {
  return value !== null && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function buildColumns(
  roleCategoryLabelById: Record<string, string>,
): ColumnDef<Candidate, unknown>[] {
  return [
    {
      id: "reference",
      accessorKey: "reference",
      header: "Reference",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-neutral-500">
          {row.original.reference}
        </span>
      ),
    },
    {
      id: "name",
      accessorKey: "displayName",
      header: "Name",
      cell: ({ row }) => (
        <span>
          <span className="font-medium text-brand-navy-ink">
            {row.original.displayName}
          </span>{" "}
          <span className="text-xs text-neutral-500">
            {row.original.firstName} {row.original.lastName}
          </span>
        </span>
      ),
    },
    {
      id: "country",
      accessorKey: "country",
      header: "Country",
      cell: ({ row }) => {
        const flag = countryFlag(row.original.country);
        return row.original.country === null ? (
          "—"
        ) : (
          <span>
            {flag !== null ? (
              // A real space (not margin alone) so "🇨🇱 Chile" never renders
              // flush and copies correctly.
              <span aria-hidden="true" className="mr-1">
                {flag}{" "}
              </span>
            ) : null}
            {row.original.country}
          </span>
        );
      },
    },
    {
      id: "roleCategory",
      accessorFn: (row) =>
        row.primaryRoleCategoryId !== null
          ? (roleCategoryLabelById[row.primaryRoleCategoryId] ?? "")
          : "",
      header: "Role category",
      cell: ({ row }) =>
        row.original.primaryRoleCategoryId !== null
          ? (roleCategoryLabelById[row.original.primaryRoleCategoryId] ?? "…")
          : "—",
    },
    {
      id: "seniority",
      accessorKey: "seniorityLevel",
      header: "Seniority",
      cell: ({ row }) =>
        row.original.seniorityLevel !== null
          ? SENIORITY_LABELS[row.original.seniorityLevel]
          : "—",
    },
    {
      id: "english",
      accessorKey: "englishSpokenLevel",
      header: "English",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1">
          {row.original.englishSpokenLevel !== null ? (
            <span className="rounded-full bg-info-subtle px-2 py-0.5 text-2xs font-medium text-info">
              {LANGUAGE_LEVEL_LABELS[row.original.englishSpokenLevel]}
            </span>
          ) : (
            "—"
          )}
          {row.original.accentStrength !== null ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-2xs font-medium text-neutral-600">
              {ACCENT_LABELS[row.original.accentStrength]}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "expectedRate",
      accessorFn: (row) => row.expectedRateAmount ?? null,
      header: "Expected rate",
      meta: meta({ numeric: true }),
      cell: ({ row }) => (
        <MoneyFigure
          parts={rateParts(
            row.original.expectedRateAmount,
            row.original.expectedRateUnit,
            row.original.expectedRateCurrency,
          )}
        />
      ),
    },
    {
      id: "poolStatus",
      accessorKey: "poolStatus",
      header: "Pool",
      cell: ({ row }) => <PoolStatusBadge status={row.original.poolStatus} />,
    },
    {
      id: "vettingStatus",
      accessorKey: "vettingStatus",
      header: "Vetting",
      cell: ({ row }) => (
        <VettingStatusBadge status={row.original.vettingStatus} />
      ),
    },
    {
      id: "dataCompleteness",
      accessorKey: "dataCompleteness",
      header: "Data",
      cell: ({ row }) => (
        <DataCompletenessBadge completeness={row.original.dataCompleteness} />
      ),
    },
    // "Available from" was dropped: the field is not captured by any intake
    // channel today (seed data has zero values), so the column was always
    // empty width. The value stays visible on the candidate detail page.
  ];
}

export function CandidatesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const roleCategoryId = searchParams.get("roleCategoryId") ?? undefined;
  const englishSpokenLevel: LanguageLevel | undefined = parseEnum(
    LanguageLevelSchema.options,
    searchParams.get("englishSpokenLevel"),
  );
  const maxAccentStrength: AccentStrength | undefined = parseEnum(
    AccentStrengthSchema.options,
    searchParams.get("maxAccentStrength"),
  );
  const poolStatus: PoolStatus | undefined = parseEnum(
    PoolStatusSchema.options,
    searchParams.get("poolStatus"),
  );
  const vettingStatus: VettingStatus | undefined = parseEnum(
    VettingStatusSchema.options,
    searchParams.get("vettingStatus"),
  );
  const rateUnit: RateUnit | undefined = parseEnum(
    RateUnitSchema.options,
    searchParams.get("rateUnit"),
  );
  const incompleteOnly = searchParams.get("dataCompleteness") === "incomplete";
  const dataCompleteness: DataCompleteness | undefined = incompleteOnly
    ? "incomplete"
    : undefined;
  const rateMaxParam = searchParams.get("rateMax") ?? "";
  const rateMax =
    rateMaxParam !== "" && Number.isFinite(Number(rateMaxParam))
      ? Number(rateMaxParam)
      : undefined;
  const toolIdsParam = searchParams.get("toolIds") ?? "";
  const toolIds = toolIdsParam === "" ? [] : toolIdsParam.split(",");

  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") ?? "",
  );
  const [countryInput, setCountryInput] = useState(
    searchParams.get("country") ?? "",
  );
  const search = useDebouncedValue(searchInput.trim());
  const country = useDebouncedValue(countryInput.trim());

  // The rate ceiling is only sent alongside its mandatory unit, so hourly
  // and monthly rates never mix (04 §8).
  const rateFilterActive = rateMax !== undefined && rateUnit !== undefined;

  const query = useCandidates({
    search: search === "" ? undefined : search,
    roleCategoryId,
    country: country === "" ? undefined : country,
    englishSpokenLevel,
    maxAccentStrength,
    poolStatus,
    vettingStatus,
    rateMax: rateFilterActive ? rateMax : undefined,
    rateUnit: rateFilterActive ? rateUnit : undefined,
    toolIds: toolIds.length > 0 ? toolIds : undefined,
    dataCompleteness,
  });

  const taxonomy = useTaxonomyOptions();
  const toolOptions = useToolOptions();

  const rows = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.data),
    [query.data],
  );

  const columns = useMemo(
    () => buildColumns(taxonomy.data?.roleCategoryLabelById ?? {}),
    [taxonomy.data],
  );

  const setParam = (key: string, value: string | null) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  // One count per logical filter (the rate ceiling counts once).
  const activeFilterCount = [
    search !== "",
    country !== "",
    roleCategoryId !== undefined,
    englishSpokenLevel !== undefined,
    maxAccentStrength !== undefined,
    poolStatus !== undefined,
    vettingStatus !== undefined,
    rateMax !== undefined || rateUnit !== undefined,
    toolIds.length > 0,
    incompleteOnly,
  ].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setSearchInput("");
    setCountryInput("");
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const clearFiltersButton = (
    <Button variant="secondary" size="sm" onClick={clearFilters}>
      <FilterX aria-hidden="true" />
      Clear filters ({activeFilterCount})
    </Button>
  );

  // The server omits nextCursor on the final page, but a short page is
  // already proof there is nothing more — hide "Load more" either way.
  const lastPage = query.data?.pages.at(-1);
  const lastPageFull =
    lastPage !== undefined && lastPage.data.length >= CANDIDATE_PAGE_SIZE;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Candidates" }]}
        title="Candidates"
        subtitle="The talent pool across all requisitions"
        actions={
          <Button asChild>
            <Link to="/admin/candidates/new">
              <Plus aria-hidden="true" />
              New candidate
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid items-end gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        <div className="space-y-1.5">
          <Label htmlFor="candidates-search">Search</Label>
          <Input
            id="candidates-search"
            type="search"
            placeholder="Name or CV text…"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setParam("search", event.target.value.trim());
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-role-category">Role category</Label>
          <NativeSelect
            id="candidates-role-category"
            value={roleCategoryId ?? ""}
            onChange={(event) => setParam("roleCategoryId", event.target.value)}
          >
            <option value="">All role categories</option>
            {(taxonomy.data?.roleCategories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-country">Country</Label>
          <Input
            id="candidates-country"
            value={countryInput}
            placeholder="e.g. Philippines"
            list="candidates-country-options"
            onChange={(event) => {
              setCountryInput(event.target.value);
              setParam("country", event.target.value.trim());
            }}
          />
          {/* Known pool countries as suggestions; free text stays allowed. */}
          <datalist id="candidates-country-options">
            {COUNTRY_NAMES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-english">English (spoken)</Label>
          <NativeSelect
            id="candidates-english"
            value={englishSpokenLevel ?? ""}
            onChange={(event) =>
              setParam("englishSpokenLevel", event.target.value)
            }
          >
            <option value="">Any level</option>
            {LanguageLevelSchema.options.map((level) => (
              <option key={level} value={level}>
                {LANGUAGE_LEVEL_LABELS[level]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-accent">Max accent</Label>
          <NativeSelect
            id="candidates-accent"
            value={maxAccentStrength ?? ""}
            onChange={(event) =>
              setParam("maxAccentStrength", event.target.value)
            }
          >
            <option value="">Any accent</option>
            {AccentStrengthSchema.options.map((strength) => (
              <option key={strength} value={strength}>
                {ACCENT_LABELS[strength]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-pool">Pool status</Label>
          <NativeSelect
            id="candidates-pool"
            value={poolStatus ?? ""}
            onChange={(event) => setParam("poolStatus", event.target.value)}
          >
            <option value="">All statuses</option>
            {PoolStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {POOL_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-vetting">Vetting</Label>
          <NativeSelect
            id="candidates-vetting"
            value={vettingStatus ?? ""}
            onChange={(event) => setParam("vettingStatus", event.target.value)}
          >
            <option value="">All statuses</option>
            {VettingStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {VETTING_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-rate-max">Rate ceiling</Label>
          <div className="flex items-center gap-2">
            <Input
              id="candidates-rate-max"
              inputMode="decimal"
              placeholder="Max"
              className="w-24"
              value={rateMaxParam}
              onChange={(event) => setParam("rateMax", event.target.value)}
            />
            <NativeSelect
              aria-label="Rate unit"
              className="w-28"
              value={rateUnit ?? ""}
              onChange={(event) => setParam("rateUnit", event.target.value)}
            >
              <option value="">Unit…</option>
              <option value="hourly">Hourly</option>
              <option value="monthly">Monthly</option>
            </NativeSelect>
          </div>
          {rateMax !== undefined && rateUnit === undefined ? (
            <p className="text-xs text-warning-text">
              Pick a unit to apply the rate ceiling.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="candidates-tools">Tools (must have all)</Label>
          <MultiSelectCombobox
            inputId="candidates-tools"
            label="Tools filter"
            options={(toolOptions.data ?? []).map((tool) => ({
              id: tool.id,
              label: tool.name,
            }))}
            selectedIds={toolIds}
            onChange={(ids) =>
              setParam("toolIds", ids.length === 0 ? null : ids.join(","))
            }
            isLoading={toolOptions.isPending}
            loadError={
              toolOptions.isError
                ? "The tool taxonomy could not be loaded."
                : null
            }
          />
        </div>
        <label
          htmlFor="candidates-incomplete"
          className="flex h-9 cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
        >
          <input
            id="candidates-incomplete"
            type="checkbox"
            className="h-4 w-4 accent-current"
            checked={incompleteOnly}
            onChange={(event) =>
              setParam(
                "dataCompleteness",
                event.target.checked ? "incomplete" : null,
              )
            }
          />
          Incomplete data only
        </label>
        {hasFilters ? clearFiltersButton : null}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        label="Candidates"
        isLoading={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{
          icon: Users,
          title: "No candidates",
          description: hasFilters
            ? "No candidates match these filters. Clear them to see the full pool."
            : "Candidates appear here when you add them manually or when they arrive via the sourcing webhook.",
          action: hasFilters ? (
            clearFiltersButton
          ) : (
            <Button asChild>
              <Link to="/admin/candidates/new">
                <Plus aria-hidden="true" />
                New candidate
              </Link>
            </Button>
          ),
        }}
        getRowHref={(candidate) => `/admin/candidates/${candidate.id}`}
        onLoadMore={() => void query.fetchNextPage()}
        hasMore={query.hasNextPage && lastPageFull}
        isLoadingMore={query.isFetchingNextPage}
        // meta.total arrives on the first page; keep it while paginating.
        totalCount={query.data?.pages[0]?.meta.total}
      />
    </div>
  );
}
