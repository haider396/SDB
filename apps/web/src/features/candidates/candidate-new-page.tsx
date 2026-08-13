/**
 * /admin/candidates/new — minimal create (AC-CA-01: only first and last
 * name are required), then straight to the detail workspace for enrichment.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import type { CreateCandidateBody } from "@sdb/contracts";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { useCreateCandidate } from "./api";

const FormSchema = z.object({
  firstName: z.string().min(1, "Enter the first name.").max(200),
  lastName: z.string().min(1, "Enter the last name.").max(200),
  preferredName: z.string().max(200),
});
type FormValues = z.infer<typeof FormSchema>;

export function CandidateNewPage() {
  const navigate = useNavigate();
  const createCandidate = useCreateCandidate();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: "onBlur",
    defaultValues: { firstName: "", lastName: "", preferredName: "" },
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  useDirtyGuard(isDirty && !isSubmitting);

  const submit = form.handleSubmit(async (values) => {
    const body: CreateCandidateBody = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      ...(values.preferredName.trim() !== ""
        ? { preferredName: values.preferredName.trim() }
        : {}),
    };
    try {
      const created = await createCandidate.mutateAsync(body);
      navigate(`/admin/candidates/${created.publicId}`, { replace: true });
    } catch (cause) {
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Could not create the candidate.",
      });
    }
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Admin", to: "/admin" },
          { label: "Candidates", to: "/admin/candidates" },
          { label: "New candidate" },
        ]}
        title="New candidate"
        subtitle="Only a name is needed to start — everything else is filled in on the profile"
      />

      <Card className="max-w-lg">
        <CardContent className="pt-6">
          <form
            onSubmit={(event) => void submit(event)}
            noValidate
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="candidate-first-name">First name</Label>
              <Input
                id="candidate-first-name"
                aria-invalid={errors.firstName !== undefined}
                {...form.register("firstName")}
              />
              {errors.firstName ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.firstName.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candidate-last-name">Last name</Label>
              <Input
                id="candidate-last-name"
                aria-invalid={errors.lastName !== undefined}
                {...form.register("lastName")}
              />
              {errors.lastName ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.lastName.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="candidate-preferred-name">
                Preferred name (optional)
              </Label>
              <Input
                id="candidate-preferred-name"
                {...form.register("preferredName")}
              />
              <p className="text-xs text-neutral-500">
                Clients see “preferred (or first) name + last initial”.
              </p>
            </div>
            {errors.root ? (
              <p role="alert" className="text-xs text-danger-text">
                {errors.root.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate("/admin/candidates")}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createCandidate.isPending}>
                {createCandidate.isPending
                  ? "Creating…"
                  : "Create and open profile"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
