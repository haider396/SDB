/**
 * Invite a client member (04 §6): email, name, job title, role, principal
 * flag. Validation errors render inline under their fields (05 §4.4).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Client, ClientMemberRole } from "@sdb/contracts";
import { ClientMemberRoleSchema } from "@sdb/contracts";
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
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api-client";
import { useInviteMember } from "../api";

const FormSchema = z.object({
  email: z
    .string()
    .min(1, "Enter the member's email.")
    .email("Enter a valid email address.")
    .max(320),
  fullName: z.string().min(1, "Enter the member's full name.").max(500),
  jobTitle: z.string().max(200),
  role: ClientMemberRoleSchema,
  isPrincipal: z.boolean(),
});
type FormValues = z.infer<typeof FormSchema>;

export const MEMBER_ROLE_LABELS: Record<ClientMemberRole, string> = {
  client_admin: "Client admin",
  client_user: "Client user",
};

export function InviteMemberDialog({
  client,
  open,
  onClose,
}: {
  client: Client;
  open: boolean;
  onClose: () => void;
}) {
  const inviteMember = useInviteMember();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      email: "",
      fullName: "",
      jobTitle: "",
      role: "client_user",
      isPrincipal: false,
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await inviteMember.mutateAsync({
        clientId: client.id,
        body: {
          email: values.email.trim(),
          fullName: values.fullName.trim(),
          jobTitle:
            values.jobTitle.trim() === "" ? undefined : values.jobTitle.trim(),
          role: values.role,
          isPrincipal: values.isPrincipal,
        },
      });
      form.reset();
      onClose();
    } catch (cause) {
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Could not send the invitation.",
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
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Sends an email invitation to join {client.companyName}&rsquo;s
              portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-full-name">Full name</Label>
              <Input
                id="invite-full-name"
                autoComplete="off"
                aria-invalid={errors.fullName !== undefined}
                {...form.register("fullName")}
              />
              {errors.fullName ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.fullName.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                aria-invalid={errors.email !== undefined}
                {...form.register("email")}
              />
              {errors.email ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.email.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-job-title">
                Job title{" "}
                <span className="font-normal text-neutral-500">(optional)</span>
              </Label>
              <Input
                id="invite-job-title"
                autoComplete="off"
                {...form.register("jobTitle")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Access</Label>
              <NativeSelect id="invite-role" {...form.register("role")}>
                {ClientMemberRoleSchema.options.map((role) => (
                  <option key={role} value={role}>
                    {MEMBER_ROLE_LABELS[role]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <label
              htmlFor="invite-principal"
              className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
            >
              <input
                id="invite-principal"
                type="checkbox"
                className="h-4 w-4 accent-current"
                {...form.register("isPrincipal")}
              />
              This person has authority to approve the brief
            </label>
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
            <Button type="submit" disabled={inviteMember.isPending}>
              {inviteMember.isPending ? "Inviting…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
