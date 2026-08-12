/**
 * Schedule-interview dialog for client_reviewing cards (P6, 04 §10, J7).
 * POST /assignments/:id/interviews is the PII gate: on success the card
 * moves to Interview scheduled and the client can see the candidate's
 * contact details. The round number is deliberately NOT asked — the API
 * assigns the next round for the assignment. A 409 INVALID_TRANSITION
 * (card no longer at client_reviewing) surfaces inline.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AdminAssignmentRow, CreateInterviewBody } from "@sdb/contracts";
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
import { useCreateInterview } from "../api";
import {
  timezoneOptions,
  viewerTimezone,
  zonedWallTimeToIso,
} from "../interview-time";

export interface ScheduleInterviewDialogProps {
  requisitionId: string;
  row: AdminAssignmentRow | null;
  onClose: () => void;
}

export function ScheduleInterviewDialog({
  requisitionId,
  row,
  onClose,
}: ScheduleInterviewDialogProps) {
  const [wallTime, setWallTime] = useState("");
  const [timezone, setTimezone] = useState(viewerTimezone());
  const [duration, setDuration] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [interviewerNames, setInterviewerNames] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const create = useCreateInterview(requisitionId);
  const zones = timezoneOptions();

  // Reset per target.
  useEffect(() => {
    setWallTime("");
    setTimezone(viewerTimezone());
    setDuration("");
    setMeetingUrl("");
    setInterviewerNames("");
    setValidationError(null);
  }, [row?.id]);

  const submit = () => {
    if (row === null) return;
    if (wallTime === "") {
      setValidationError("A date and time are required.");
      return;
    }
    const minutes = duration.trim() === "" ? null : Number(duration);
    if (
      minutes !== null &&
      (!Number.isInteger(minutes) || minutes < 5 || minutes > 600)
    ) {
      setValidationError("Duration must be a whole number of minutes, 5–600.");
      return;
    }
    setValidationError(null);

    const body: CreateInterviewBody = {
      scheduledAt: zonedWallTimeToIso(wallTime, timezone),
      timezone,
      ...(minutes !== null ? { durationMinutes: minutes } : {}),
      ...(meetingUrl.trim() === "" ? {} : { meetingUrl: meetingUrl.trim() }),
      ...(interviewerNames.trim() === ""
        ? {}
        : { interviewerNames: interviewerNames.trim() }),
    };

    create.mutate(
      { assignmentId: row.id, body },
      {
        onSuccess: (interview) => {
          toast.success(
            `Interview round ${interview.roundNumber} scheduled for ${row.candidate.displayName}. Their contact details are now visible to the client.`,
          );
          onClose();
        },
        onError: (error) => {
          if (
            error instanceof ApiError &&
            error.code === "INVALID_TRANSITION"
          ) {
            setValidationError(
              "This candidate is no longer at Client reviewing, so an interview cannot be scheduled. Refresh the board to see their current stage.",
            );
            return;
          }
          setValidationError(
            error instanceof ApiError
              ? error.message
              : "Scheduling failed. Please try again.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Schedule interview for {row?.candidate.displayName ?? "candidate"}
          </DialogTitle>
          <DialogDescription>
            Moves the candidate to Interview scheduled and unlocks their
            contact details for the client. The round number is assigned
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="interview-when">Date &amp; time</Label>
              <Input
                id="interview-when"
                type="datetime-local"
                value={wallTime}
                onChange={(event) => setWallTime(event.target.value)}
                aria-invalid={validationError !== null && wallTime === ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interview-timezone">Timezone</Label>
              <NativeSelect
                id="interview-timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-neutral-500">
                The time above is read in this zone.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="interview-duration">
                Duration, minutes (optional)
              </Label>
              <Input
                id="interview-duration"
                type="number"
                min={5}
                max={600}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interview-url">Meeting link (optional)</Label>
              <Input
                id="interview-url"
                type="url"
                placeholder="https://…"
                value={meetingUrl}
                onChange={(event) => setMeetingUrl(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="interview-interviewers">
              Interviewer names (optional)
            </Label>
            <Input
              id="interview-interviewers"
              value={interviewerNames}
              onChange={(event) => setInterviewerNames(event.target.value)}
              maxLength={1000}
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
          <Button disabled={create.isPending} onClick={submit}>
            {create.isPending ? "Scheduling…" : "Schedule interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
