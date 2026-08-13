/**
 * Place dialog for offer-stage cards → POST /assignments/:id/place, the
 * AC-PL-13 transaction: placement row, assignment + requisition to
 * `placed`, siblings to `closed_not_selected`, candidate pool_status to
 * `placed` — all or nothing. After success the dialog shows an explicit
 * outcome state so the sibling closure is never a surprise on the board.
 */
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type {
  AdminAssignmentRow,
  PlaceBody,
  RateUnit,
  ServiceTier,
} from "@sdb/contracts";
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
import { usePlaceAssignment } from "../api";

export interface PlaceDialogProps {
  requisitionId: string;
  row: AdminAssignmentRow | null;
  onClose: () => void;
}

const RATE_UNIT_OPTIONS: readonly RateUnit[] = ["hourly", "monthly"];
const SERVICE_TIER_OPTIONS: readonly ServiceTier[] = [
  "standard_placement",
  "handheld_six_month",
];

export function PlaceDialog({ requisitionId, row, onClose }: PlaceDialogProps) {
  const [startDate, setStartDate] = useState("");
  const [rateAmount, setRateAmount] = useState("");
  const [rateUnit, setRateUnit] = useState<"" | RateUnit>("");
  const [rateCurrency, setRateCurrency] = useState("USD");
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [serviceTier, setServiceTier] = useState<"" | ServiceTier>("");
  const [guaranteeEndDate, setGuaranteeEndDate] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [isPlaced, setIsPlaced] = useState(false);

  const place = usePlaceAssignment(requisitionId);

  useEffect(() => {
    setStartDate("");
    setRateAmount("");
    setRateUnit("");
    setRateCurrency("USD");
    setHoursPerWeek("");
    setServiceTier("");
    setGuaranteeEndDate("");
    setValidationError(null);
    setUnitError(null);
    setIsPlaced(false);
  }, [row?.id]);

  const submit = () => {
    if (row === null) return;
    if (startDate === "") {
      setValidationError("A start date is required.");
      return;
    }
    const amount = rateAmount.trim() === "" ? null : Number(rateAmount);
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      setValidationError("The rate must be a non-negative number.");
      return;
    }
    // 02 §7 precedent (fields-card): a money amount without a unit is
    // ambiguous — refuse it here before the API does. Unit without an
    // amount is fine.
    if (amount !== null && rateUnit === "") {
      setUnitError("Pick a unit — an amount without a unit is ambiguous.");
      return;
    }
    setUnitError(null);
    const hours = hoursPerWeek.trim() === "" ? null : Number(hoursPerWeek);
    if (
      hours !== null &&
      (!Number.isInteger(hours) || hours < 1 || hours > 168)
    ) {
      setValidationError("Hours per week must be a whole number from 1 to 168.");
      return;
    }
    setValidationError(null);

    const body: PlaceBody = {
      startDate,
      ...(amount !== null ? { rateAmount: amount } : {}),
      ...(rateUnit !== "" ? { rateUnit } : {}),
      ...(amount !== null ? { rateCurrency: rateCurrency.toUpperCase() } : {}),
      ...(hours !== null ? { hoursPerWeek: hours } : {}),
      ...(serviceTier !== "" ? { serviceTier } : {}),
      ...(guaranteeEndDate !== "" ? { guaranteeEndDate } : {}),
    };

    place.mutate(
      { assignmentId: row.id, body },
      {
        onSuccess: () => setIsPlaced(true),
        onError: (error) => {
          setValidationError(
            error instanceof ApiError
              ? error.message
              : "Placing failed. Please try again.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {isPlaced ? (
          <>
            <DialogHeader>
              <DialogTitle>Placement created</DialogTitle>
            </DialogHeader>
            <div className="flex items-start gap-3">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-success"
              />
              <p className="text-sm text-neutral-800">
                {row?.candidate.displayName ?? "The candidate"} is placed. The
                requisition moved to <strong>Placed</strong>, and every other
                candidate still in this pipeline was closed as{" "}
                <strong>Not selected</strong> — you will see them in the Closed
                group on the board.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Place {row?.candidate.displayName ?? "candidate"}
              </DialogTitle>
              <DialogDescription>
                Creates the placement and closes all other candidates on this
                requisition as not selected.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="place-start-date">Start date</Label>
                <Input
                  id="place-start-date"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  aria-invalid={validationError !== null && startDate === ""}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="place-rate-amount">Rate</Label>
                  <Input
                    id="place-rate-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={rateAmount}
                    onChange={(event) => setRateAmount(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="place-rate-unit">Per</Label>
                  <NativeSelect
                    id="place-rate-unit"
                    value={rateUnit}
                    aria-invalid={unitError !== null || undefined}
                    onChange={(event) => {
                      setRateUnit(event.target.value as "" | RateUnit);
                      if (event.target.value !== "") setUnitError(null);
                    }}
                  >
                    <option value="">—</option>
                    {RATE_UNIT_OPTIONS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit === "hourly" ? "Hour" : "Month"}
                      </option>
                    ))}
                  </NativeSelect>
                  {unitError !== null ? (
                    <p role="alert" className="text-xs text-danger-text">
                      {unitError}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="place-rate-currency">Currency</Label>
                  <Input
                    id="place-rate-currency"
                    value={rateCurrency}
                    onChange={(event) => setRateCurrency(event.target.value)}
                    maxLength={3}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="place-hours">Hours / week</Label>
                  <Input
                    id="place-hours"
                    type="number"
                    min={1}
                    max={168}
                    value={hoursPerWeek}
                    onChange={(event) => setHoursPerWeek(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="place-service-tier">Service tier</Label>
                  <NativeSelect
                    id="place-service-tier"
                    value={serviceTier}
                    onChange={(event) =>
                      setServiceTier(event.target.value as "" | ServiceTier)
                    }
                  >
                    <option value="">—</option>
                    {SERVICE_TIER_OPTIONS.map((tier) => (
                      <option key={tier} value={tier}>
                        {SERVICE_TIER_LABELS[tier]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="place-guarantee-end">
                  Guarantee end date (optional)
                </Label>
                <Input
                  id="place-guarantee-end"
                  type="date"
                  value={guaranteeEndDate}
                  onChange={(event) => setGuaranteeEndDate(event.target.value)}
                />
              </div>

              {validationError !== null ? (
                <p role="alert" className="text-sm text-danger-text">
                  {validationError}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={place.isPending} onClick={submit}>
                {place.isPending ? "Placing…" : "Place candidate"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
