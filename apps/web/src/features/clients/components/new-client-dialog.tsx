/**
 * Manual client creation (04 §6 POST /clients) — the path outside the
 * intake funnel: company name required, profile fields optional. On success
 * the dialog navigates straight to the new client's workspace.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import type { CreateClientBody } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useCreateClient } from "../api";

const FormSchema = z.object({
  companyName: z.string().min(1, "Enter the company name.").max(500),
  website: z.string().max(500),
  industry: z.string().max(200),
  teamSizeBand: z.string().max(100),
  companyTimezone: z.string().max(100),
});
type FormValues = z.infer<typeof FormSchema>;

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function NewClientDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const createClient = useCreateClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      companyName: "",
      website: "",
      industry: "",
      teamSizeBand: "",
      companyTimezone: "",
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const body: CreateClientBody = {
      companyName: values.companyName.trim(),
      website: orNull(values.website),
      industry: orNull(values.industry),
      teamSizeBand: orNull(values.teamSizeBand),
      companyTimezone: orNull(values.companyTimezone),
    };
    try {
      const created = await createClient.mutateAsync(body);
      form.reset();
      onClose();
      navigate(`/admin/clients/${created.id}`);
    } catch (cause) {
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Could not create the client.",
      });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
            <DialogDescription>
              Creates a client record directly — for companies arriving
              outside the public intake form.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-client-company-name">Company name</Label>
              <Input
                id="new-client-company-name"
                autoComplete="off"
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
              <Label htmlFor="new-client-website">
                Website{" "}
                <span className="font-normal text-neutral-500">(optional)</span>
              </Label>
              <Input
                id="new-client-website"
                autoComplete="off"
                {...form.register("website")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-client-industry">
                Industry{" "}
                <span className="font-normal text-neutral-500">(optional)</span>
              </Label>
              <Input
                id="new-client-industry"
                autoComplete="off"
                {...form.register("industry")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-client-team-size">
                Team size{" "}
                <span className="font-normal text-neutral-500">(optional)</span>
              </Label>
              <Input
                id="new-client-team-size"
                autoComplete="off"
                placeholder="e.g. 11-50"
                {...form.register("teamSizeBand")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-client-timezone">
                Company timezone{" "}
                <span className="font-normal text-neutral-500">(optional)</span>
              </Label>
              <Input
                id="new-client-timezone"
                autoComplete="off"
                placeholder="e.g. America/New_York"
                {...form.register("companyTimezone")}
              />
            </div>
            {errors.root ? (
              <p role="alert" className="text-xs text-danger-text">
                {errors.root.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createClient.isPending}>
              {createClient.isPending ? "Creating…" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
