/**
 * Grant portal access (J2 step 4): invites the primary contact as
 * client_admin. The submit is disabled with an explanation while payment is
 * unconfirmed, and the API's 422 PAYMENT_NOT_CONFIRMED is still surfaced in
 * case of a race (AC-CL-01).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Client } from "@sdb/contracts";
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
import { useGrantAccess } from "../api";

const FormSchema = z.object({
  primaryContactEmail: z
    .string()
    .min(1, "Enter the contact's email.")
    .email("Enter a valid email address.")
    .max(320),
  primaryContactName: z.string().min(1, "Enter the contact's name.").max(500),
  isPrincipal: z.boolean(),
});
type FormValues = z.infer<typeof FormSchema>;

export function GrantAccessDialog({
  client,
  open,
  onClose,
}: {
  client: Client;
  open: boolean;
  onClose: () => void;
}) {
  const grantAccess = useGrantAccess();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      primaryContactEmail: "",
      primaryContactName: "",
      isPrincipal: true,
    },
  });
  const { errors } = form.formState;

  const paymentConfirmed = client.paymentConfirmedAt !== null;

  const submit = form.handleSubmit(async (values) => {
    try {
      await grantAccess.mutateAsync({
        id: client.id,
        body: {
          primaryContactEmail: values.primaryContactEmail.trim(),
          primaryContactName: values.primaryContactName.trim(),
          isPrincipal: values.isPrincipal,
        },
      });
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "PAYMENT_NOT_CONFIRMED") {
        form.setError("root", {
          message:
            "Payment has not been confirmed for this client. Confirm payment first, then grant access.",
        });
      } else {
        form.setError("root", {
          message:
            cause instanceof ApiError
              ? cause.message
              : "Could not grant portal access.",
        });
      }
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
            <DialogTitle>Grant portal access</DialogTitle>
            <DialogDescription>
              Invites the primary contact of {client.companyName} as a client
              admin. They receive an invitation email to set a password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="grant-contact-name">Primary contact name</Label>
              <Input
                id="grant-contact-name"
                autoComplete="off"
                aria-invalid={errors.primaryContactName !== undefined}
                {...form.register("primaryContactName")}
              />
              {errors.primaryContactName ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.primaryContactName.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-contact-email">Primary contact email</Label>
              <Input
                id="grant-contact-email"
                type="email"
                autoComplete="off"
                aria-invalid={errors.primaryContactEmail !== undefined}
                {...form.register("primaryContactEmail")}
              />
              {errors.primaryContactEmail ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.primaryContactEmail.message}
                </p>
              ) : null}
            </div>
            <label
              htmlFor="grant-principal"
              className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
            >
              <input
                id="grant-principal"
                type="checkbox"
                className="h-4 w-4 accent-current"
                {...form.register("isPrincipal")}
              />
              This person has authority to approve the brief
            </label>
            {!paymentConfirmed ? (
              <p
                className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text"
                id="grant-access-blocked"
              >
                Payment has not been confirmed for this client yet. Confirm
                payment first — the API rejects access grants until then.
              </p>
            ) : null}
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
            <Button
              type="submit"
              disabled={!paymentConfirmed || grantAccess.isPending}
              aria-describedby={
                paymentConfirmed ? undefined : "grant-access-blocked"
              }
            >
              {grantAccess.isPending ? "Granting…" : "Grant access"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
