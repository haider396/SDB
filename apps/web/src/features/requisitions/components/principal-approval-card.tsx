/**
 * Principal approval card (J3): shows who the principal is, offers
 * "Request approval" once a brief is drafted (from submitted or
 * changes_requested), and surfaces the principal's change-request comment
 * while in changes_requested.
 */
import { Send, UserCheck } from "lucide-react";
import { useState } from "react";
import type { RequisitionDetail } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useClientMembers } from "@/features/clients/api";
import { useRequestPrincipalApproval } from "../api";

export function PrincipalApprovalCard({
  requisition,
}: {
  requisition: RequisitionDetail;
}) {
  const requestApproval = useRequestPrincipalApproval();
  const membersQuery = useClientMembers(requisition.clientId);
  const [error, setError] = useState<string | null>(null);

  const principal =
    requisition.principalUserId === null
      ? undefined
      : membersQuery.data?.find(
          (member) => member.userId === requisition.principalUserId,
        );

  // T16: approval is now gated on the JOB DESCRIPTION, not the retired
  // brief — that is the document the principal is actually approving.
  const briefDrafted =
    requisition.jobDescription !== null &&
    requisition.jobDescription.trim() !== "";
  const canRequest =
    (requisition.status === "submitted" ||
      requisition.status === "changes_requested") &&
    briefDrafted;
  const isAwaiting = requisition.status === "pending_principal_approval";

  const request = async () => {
    setError(null);
    try {
      await requestApproval.mutateAsync({ id: requisition.id });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not request approval.",
      );
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <UserCheck aria-hidden="true" className="h-4 w-4 text-neutral-500" />
        <CardTitle className="text-base">Principal approval</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="text-sm">
          <div className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-neutral-500">Principal</dt>
            <dd className="text-right text-neutral-800">
              {principal !== undefined
                ? principal.fullName
                : requisition.principalUserId !== null
                  ? "Assigned"
                  : "Not assigned"}
            </dd>
          </div>
          {requisition.principalApprovedAt !== null ? (
            <div className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-neutral-500">Approved</dt>
              <dd className="text-right text-success-text">
                {formatDateTime(requisition.principalApprovedAt)}
              </dd>
            </div>
          ) : null}
        </dl>

        {requisition.status === "changes_requested" &&
        requisition.principalChangeRequest !== null ? (
          <div className="rounded-md bg-warning-subtle px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning-text">
              Changes requested
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-warning-text">
              {requisition.principalChangeRequest}
            </p>
          </div>
        ) : null}

        {isAwaiting ? (
          <p className="text-sm text-neutral-500">
            Waiting for the principal to approve the brief or request changes.
          </p>
        ) : canRequest ? (
          <Button
            size="sm"
            className="w-full"
            onClick={() => void request()}
            disabled={requestApproval.isPending}
          >
            <Send aria-hidden="true" />
            {requestApproval.isPending ? "Requesting…" : "Request approval"}
          </Button>
        ) : requisition.status === "submitted" ||
          requisition.status === "changes_requested" ? (
          <p className="text-sm text-neutral-500">
            Draft the brief first — approval can be requested once it has
            content.
          </p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
