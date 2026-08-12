/**
 * Edit client sheet: company profile fields plus status and service tier.
 * Dirty-guarded (AC-UI-09) like the question editor.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Client, UpdateClientBody } from "@sdb/contracts";
import { ClientStatusSchema, ServiceTierSchema } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError } from "@/lib/api-client";
import { SERVICE_TIER_LABELS } from "@/lib/format";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { useUpdateClient } from "../api";

const FormSchema = z.object({
  companyName: z.string().min(1, "Enter the company name.").max(500),
  website: z.string().max(500),
  industry: z.string().max(200),
  teamSizeBand: z.string().max(100),
  companyTimezone: z.string().max(100),
  status: ClientStatusSchema,
  serviceTier: z.union([ServiceTierSchema, z.literal("")]),
});
type FormValues = z.infer<typeof FormSchema>;

const STATUS_LABELS: Record<Client["status"], string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function EditClientSheet({
  client,
  open,
  onClose,
}: {
  client: Client;
  open: boolean;
  onClose: () => void;
}) {
  const updateClient = useUpdateClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values: {
      companyName: client.companyName,
      website: client.website ?? "",
      industry: client.industry ?? "",
      teamSizeBand: client.teamSizeBand ?? "",
      companyTimezone: client.companyTimezone ?? "",
      status: client.status,
      serviceTier: client.serviceTier ?? "",
    },
  });
  const { errors, isDirty } = form.formState;
  useDirtyGuard(open && isDirty);

  const requestClose = () => {
    if (
      isDirty &&
      !window.confirm("You have unsaved changes. Discard them?")
    ) {
      return;
    }
    form.reset();
    onClose();
  };

  const submit = form.handleSubmit(async (values) => {
    const body: UpdateClientBody = {
      companyName: values.companyName.trim(),
      website: orNull(values.website),
      industry: orNull(values.industry),
      teamSizeBand: orNull(values.teamSizeBand),
      companyTimezone: orNull(values.companyTimezone),
      status: values.status,
      serviceTier: values.serviceTier === "" ? null : values.serviceTier,
    };
    try {
      const updated = await updateClient.mutateAsync({ id: client.id, body });
      form.reset({
        companyName: updated.companyName,
        website: updated.website ?? "",
        industry: updated.industry ?? "",
        teamSizeBand: updated.teamSizeBand ?? "",
        companyTimezone: updated.companyTimezone ?? "",
        status: updated.status,
        serviceTier: updated.serviceTier ?? "",
      });
      onClose();
    } catch (cause) {
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Could not save the client.",
      });
    }
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <SheetContent>
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="flex h-full flex-col"
        >
          <SheetHeader>
            <SheetTitle>Edit client</SheetTitle>
            <SheetDescription>{client.companyName}</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-company-name">Company name</Label>
              <Input
                id="client-company-name"
                aria-invalid={errors.companyName !== undefined}
                {...form.register("companyName")}
              />
              {errors.companyName ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.companyName.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-website">Website</Label>
              <Input id="client-website" {...form.register("website")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-industry">Industry</Label>
              <Input id="client-industry" {...form.register("industry")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-team-size">Team size band</Label>
              <Input id="client-team-size" {...form.register("teamSizeBand")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-timezone">Company timezone</Label>
              <Input
                id="client-timezone"
                placeholder="e.g. America/New_York"
                {...form.register("companyTimezone")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-status">Status</Label>
              <NativeSelect id="client-status" {...form.register("status")}>
                {ClientStatusSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-service-tier">Service tier</Label>
              <NativeSelect
                id="client-service-tier"
                {...form.register("serviceTier")}
              >
                <option value="">Not set</option>
                {ServiceTierSchema.options.map((tier) => (
                  <option key={tier} value={tier}>
                    {SERVICE_TIER_LABELS[tier]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {errors.root ? (
              <p role="alert" className="text-xs text-danger-text">
                {errors.root.message}
              </p>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateClient.isPending}>
              {updateClient.isPending ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
