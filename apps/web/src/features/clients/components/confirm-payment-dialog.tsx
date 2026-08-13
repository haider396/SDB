/**
 * Confirm payment (J2 step 2–3): date, optional invoice reference, and the
 * mandatory service tier. Unlocks the grant-access action.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Client } from "@sdb/contracts";
import { ServiceTierSchema } from "@sdb/contracts";
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
import { SERVICE_TIER_LABELS } from "@/lib/format";
import { useConfirmPayment } from "../api";

const FormSchema = z.object({
  paymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the payment date."),
  invoiceReference: z.string().max(200),
  serviceTier: ServiceTierSchema,
});
type FormValues = z.infer<typeof FormSchema>;

export function ConfirmPaymentDialog({
  client,
  open,
  onClose,
  onConfirmed,
}: {
  client: Client;
  open: boolean;
  onClose: () => void;
  /** Fires after a successful confirm (e.g. to offer granting access next). */
  onConfirmed?: () => void;
}) {
  const confirmPayment = useConfirmPayment();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      paymentDate: new Date().toISOString().slice(0, 10),
      invoiceReference: client.invoiceReference ?? "",
      serviceTier: client.serviceTier ?? "standard_placement",
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await confirmPayment.mutateAsync({
        id: client.id,
        body: {
          paymentConfirmedAt: new Date(
            `${values.paymentDate}T00:00:00Z`,
          ).toISOString(),
          invoiceReference:
            values.invoiceReference.trim() === ""
              ? undefined
              : values.invoiceReference.trim(),
          serviceTier: values.serviceTier,
        },
      });
      onClose();
      onConfirmed?.();
    } catch (cause) {
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Could not confirm the payment.",
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
            <DialogTitle>Confirm payment</DialogTitle>
            <DialogDescription>
              Records that {client.companyName} has paid. Portal access can be
              granted once this is saved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="payment-date">Payment date</Label>
              <Input
                id="payment-date"
                type="date"
                aria-invalid={errors.paymentDate !== undefined}
                {...form.register("paymentDate")}
              />
              {errors.paymentDate ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.paymentDate.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-invoice">
                Invoice reference{" "}
                <span className="font-normal text-neutral-500">(optional)</span>
              </Label>
              <Input
                id="payment-invoice"
                autoComplete="off"
                {...form.register("invoiceReference")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-tier">Service tier</Label>
              <NativeSelect id="payment-tier" {...form.register("serviceTier")}>
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
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={confirmPayment.isPending}>
              {confirmPayment.isPending ? "Saving…" : "Confirm payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
