/**
 * Requisition fields editor: role facts, engagement, and — only when the
 * caller's payload carries the commercial keys (AC-RQ-06) — the budget with
 * an explicit unit selector (02 §7: a unit is mandatory whenever an amount
 * is present; checked here on submit so it fails before the API does).
 * Principal is selected from the client's members. Dirty-guarded (AC-UI-09).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { RequisitionDetail, UpdateRequisitionBody } from "@sdb/contracts";
import {
  EngagementTypeSchema,
  RateUnitSchema,
  SeniorityLevelSchema,
} from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api-client";
import {
  ENGAGEMENT_LABELS,
  RATE_UNIT_LABELS,
  SENIORITY_LABELS,
} from "@/lib/format";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { useClientMembers } from "@/features/clients/api";
import { timezoneOptions } from "@/features/pipeline/interview-time";
import { useUpdateRequisition } from "../api";

const FormSchema = z
  .object({
    advertisedTitle: z.string().max(500),
    headcount: z.coerce.number().int().min(1, "Headcount must be at least 1."),
    seniorityLevel: z.union([SeniorityLevelSchema, z.literal("")]),
    engagementType: z.union([EngagementTypeSchema, z.literal("")]),
    hoursPerWeek: z.string(),
    overlapStart: z.string(),
    overlapEnd: z.string(),
    overlapTimezone: z.string(),
    targetStartDate: z.string(),
    urgency: z.string().max(200),
    regionPreference: z.string().max(500),
    principalUserId: z.string(),
    budgetMin: z.string(),
    budgetMax: z.string(),
    budgetUnit: z.union([RateUnitSchema, z.literal("")]),
    budgetCurrency: z
      .string()
      .refine((value) => value === "" || /^[A-Za-z]{3}$/.test(value), {
        message: "Use a 3-letter currency code, e.g. USD.",
      }),
    budgetIsFlexible: z.boolean(),
  })
  .superRefine((values, context) => {
    const hasAmount = values.budgetMin !== "" || values.budgetMax !== "";
    if (hasAmount && values.budgetUnit === "") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budgetUnit"],
        message: "Pick a unit — an amount without a unit is ambiguous.",
      });
    }
    const hasOverlapTime = values.overlapStart !== "" || values.overlapEnd !== "";
    if (hasOverlapTime && values.overlapTimezone === "") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlapTimezone"],
        message: "Pick a timezone — an overlap window without one is ambiguous.",
      });
    }
  });
type FormValues = z.infer<typeof FormSchema>;

function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function defaults(requisition: RequisitionDetail): FormValues {
  return {
    advertisedTitle: requisition.advertisedTitle ?? "",
    headcount: requisition.headcount,
    seniorityLevel: requisition.seniorityLevel ?? "",
    engagementType: requisition.engagementType ?? "",
    hoursPerWeek:
      requisition.hoursPerWeek === null ? "" : String(requisition.hoursPerWeek),
    // Stored as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'.
    overlapStart: requisition.overlapStart?.slice(0, 5) ?? "",
    overlapEnd: requisition.overlapEnd?.slice(0, 5) ?? "",
    overlapTimezone: requisition.overlapTimezone ?? "",
    targetStartDate: requisition.targetStartDate ?? "",
    urgency: requisition.urgency ?? "",
    regionPreference: requisition.regionPreference ?? "",
    principalUserId: requisition.principalUserId ?? "",
    budgetMin:
      requisition.budgetMin === null || requisition.budgetMin === undefined
        ? ""
        : String(requisition.budgetMin),
    budgetMax:
      requisition.budgetMax === null || requisition.budgetMax === undefined
        ? ""
        : String(requisition.budgetMax),
    budgetUnit: requisition.budgetUnit ?? "",
    budgetCurrency: requisition.budgetCurrency ?? "",
    budgetIsFlexible: requisition.budgetIsFlexible ?? false,
  };
}

export function FieldsCard({ requisition }: { requisition: RequisitionDetail }) {
  const updateRequisition = useUpdateRequisition();
  const membersQuery = useClientMembers(requisition.clientId);

  // Commercial keys are ABSENT without requisition.view_commercials.
  const hasCommercials = "budgetMin" in requisition;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values: defaults(requisition),
  });
  const { errors, isDirty } = form.formState;
  useDirtyGuard(isDirty);

  const submit = form.handleSubmit(async (values) => {
    const body: UpdateRequisitionBody = {
      advertisedTitle:
        values.advertisedTitle.trim() === ""
          ? null
          : values.advertisedTitle.trim(),
      headcount: values.headcount,
      seniorityLevel:
        values.seniorityLevel === "" ? null : values.seniorityLevel,
      engagementType:
        values.engagementType === "" ? null : values.engagementType,
      hoursPerWeek: toNumberOrNull(values.hoursPerWeek),
      overlapStart: values.overlapStart === "" ? null : values.overlapStart,
      overlapEnd: values.overlapEnd === "" ? null : values.overlapEnd,
      overlapTimezone:
        values.overlapTimezone === "" ? null : values.overlapTimezone,
      targetStartDate:
        values.targetStartDate === "" ? null : values.targetStartDate,
      urgency: values.urgency.trim() === "" ? null : values.urgency.trim(),
      regionPreference:
        values.regionPreference.trim() === ""
          ? null
          : values.regionPreference.trim(),
      principalUserId:
        values.principalUserId === "" ? null : values.principalUserId,
      ...(hasCommercials
        ? {
            budgetMin: toNumberOrNull(values.budgetMin),
            budgetMax: toNumberOrNull(values.budgetMax),
            budgetUnit: values.budgetUnit === "" ? null : values.budgetUnit,
            budgetCurrency:
              values.budgetCurrency.trim() === ""
                ? null
                : values.budgetCurrency.trim().toUpperCase(),
            budgetIsFlexible: values.budgetIsFlexible,
          }
        : {}),
    };
    try {
      const updated = await updateRequisition.mutateAsync({
        id: requisition.id,
        body,
      });
      form.reset(defaults(updated));
    } catch (cause) {
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Could not save the requisition.",
      });
    }
  });

  const members = (membersQuery.data ?? []).filter(
    (member) => member.isActive,
  );
  // Same IANA zone list as the interview dialog (NFR-11).
  const zones = timezoneOptions();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requisition fields</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Advertised title</Label>
              <Input id="req-title" {...form.register("advertisedTitle")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-headcount">Headcount</Label>
              <Input
                id="req-headcount"
                type="number"
                min={1}
                aria-invalid={errors.headcount !== undefined}
                {...form.register("headcount")}
              />
              {errors.headcount ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.headcount.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-seniority">Seniority</Label>
              <NativeSelect
                id="req-seniority"
                {...form.register("seniorityLevel")}
              >
                <option value="">Not set</option>
                {SeniorityLevelSchema.options.map((level) => (
                  <option key={level} value={level}>
                    {SENIORITY_LABELS[level]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-engagement">Engagement</Label>
              <NativeSelect
                id="req-engagement"
                {...form.register("engagementType")}
              >
                <option value="">Not set</option>
                {EngagementTypeSchema.options.map((type) => (
                  <option key={type} value={type}>
                    {ENGAGEMENT_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-hours">Hours per week</Label>
              <Input
                id="req-hours"
                type="number"
                min={1}
                max={168}
                {...form.register("hoursPerWeek")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-start-date">Target start date</Label>
              <Input
                id="req-start-date"
                type="date"
                {...form.register("targetStartDate")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-overlap-start">Overlap from</Label>
              <Input
                id="req-overlap-start"
                type="time"
                {...form.register("overlapStart")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-overlap-end">Overlap until</Label>
              <Input
                id="req-overlap-end"
                type="time"
                {...form.register("overlapEnd")}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="req-overlap-timezone">Overlap timezone</Label>
              <NativeSelect
                id="req-overlap-timezone"
                aria-invalid={errors.overlapTimezone !== undefined}
                {...form.register("overlapTimezone")}
              >
                <option value="">Not set</option>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </NativeSelect>
              {errors.overlapTimezone ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.overlapTimezone.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-urgency">Urgency</Label>
              <Input id="req-urgency" {...form.register("urgency")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-region">Region preference</Label>
              <Input id="req-region" {...form.register("regionPreference")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="req-principal">Principal (approves the brief)</Label>
              <NativeSelect
                id="req-principal"
                {...form.register("principalUserId")}
              >
                <option value="">Not set</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.fullName} ({member.email})
                    {member.isPrincipal ? " — principal" : ""}
                  </option>
                ))}
              </NativeSelect>
              {membersQuery.isError ? (
                <p role="alert" className="text-xs text-danger-text">
                  Could not load this client&rsquo;s members.
                </p>
              ) : null}
            </div>
          </div>

          {hasCommercials ? (
            <fieldset className="rounded-md border border-border-default p-4">
              <legend className="px-1 text-sm font-medium text-neutral-800">
                Budget
              </legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="req-budget-min">Minimum</Label>
                  <Input
                    id="req-budget-min"
                    type="number"
                    min={0}
                    {...form.register("budgetMin")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-budget-max">Maximum</Label>
                  <Input
                    id="req-budget-max"
                    type="number"
                    min={0}
                    {...form.register("budgetMax")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-budget-unit">Unit</Label>
                  <NativeSelect
                    id="req-budget-unit"
                    aria-invalid={errors.budgetUnit !== undefined}
                    {...form.register("budgetUnit")}
                  >
                    <option value="">Not set</option>
                    {RateUnitSchema.options.map((unit) => (
                      <option key={unit} value={unit}>
                        Per {RATE_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </NativeSelect>
                  {errors.budgetUnit ? (
                    <p role="alert" className="text-xs text-danger-text">
                      {errors.budgetUnit.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-budget-currency">Currency</Label>
                  <Input
                    id="req-budget-currency"
                    placeholder="USD"
                    maxLength={3}
                    aria-invalid={errors.budgetCurrency !== undefined}
                    {...form.register("budgetCurrency")}
                  />
                  {errors.budgetCurrency ? (
                    <p role="alert" className="text-xs text-danger-text">
                      {errors.budgetCurrency.message}
                    </p>
                  ) : null}
                </div>
                <label
                  htmlFor="req-budget-flexible"
                  className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800 sm:col-span-2"
                >
                  <input
                    id="req-budget-flexible"
                    type="checkbox"
                    className="h-4 w-4 accent-current"
                    {...form.register("budgetIsFlexible")}
                  />
                  Budget is flexible
                </label>
              </div>
            </fieldset>
          ) : null}

          {errors.root ? (
            <p role="alert" className="text-xs text-danger-text">
              {errors.root.message}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            {isDirty ? (
              <span className="text-xs text-neutral-500">Unsaved changes</span>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={!isDirty || updateRequisition.isPending}
            >
              {updateRequisition.isPending ? "Saving…" : "Save fields"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
