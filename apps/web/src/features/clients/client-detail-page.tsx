/**
 * /admin/clients/:id — the client workspace (J2). Two-column at ≥1280 px:
 * company info, members, and requisitions left; status, payment, access, and
 * internal notes in a sticky right rail (05 §4.1).
 */
import {
  CircleDollarSign,
  ExternalLink,
  KeyRound,
  Pencil,
  ShieldOff,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import type { Client } from "@sdb/contracts";
import { ErrorState } from "@/components/patterns/error-state";
import { EventLogCard } from "@/components/patterns/event-log-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { ClientStatusBadge } from "@/components/patterns/status-badge";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatDateTime, SERVICE_TIER_LABELS } from "@/lib/format";
import { useClient, useClientEvents, useRevokeAccess } from "./api";
import { ClientRequisitionsCard } from "./components/client-requisitions-card";
import { ConfirmPaymentDialog } from "./components/confirm-payment-dialog";
import { EditClientSheet } from "./components/edit-client-sheet";
import { GrantAccessDialog } from "./components/grant-access-dialog";
import { InternalNotesCard } from "./components/internal-notes-card";
import { MembersCard } from "./components/members-card";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sm text-neutral-500">{label}</dt>
      <dd className="text-right text-sm text-neutral-800">{value}</dd>
    </div>
  );
}

/** The stored website is free text; give hrefs a scheme when it lacks one. */
function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function CompanyInfoCard({ client }: { client: Client }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Company</CardTitle>
      </CardHeader>
      <CardContent>
        <dl>
          <InfoRow
            label="Website"
            value={
              client.website === null ? (
                "—"
              ) : (
                <a
                  href={websiteHref(client.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline"
                >
                  {client.website}
                  <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )
            }
          />
          <InfoRow label="Industry" value={client.industry ?? "—"} />
          <InfoRow label="Team size" value={client.teamSizeBand ?? "—"} />
          <InfoRow label="Timezone" value={client.companyTimezone ?? "—"} />
          <InfoRow label="Created" value={formatDate(client.createdAt)} />
        </dl>
        {"onboardingReadinessNote" in client &&
        client.onboardingReadinessNote !== null &&
        client.onboardingReadinessNote !== undefined ? (
          <>
            <Separator className="my-3" />
            <p className="text-sm text-neutral-500">Onboarding readiness</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">
              {client.onboardingReadinessNote}
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const clientId = id ?? "";
  const query = useClient(clientId);
  // The route param may be a public id; /events needs the real UUID.
  const eventsQuery = useClientEvents(query.data?.id);
  const revokeAccess = useRevokeAccess();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isGrantOpen, setIsGrantOpen] = useState(false);
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);

  const breadcrumbs = [
    { label: "Admin", to: "/admin" },
    { label: "Clients", to: "/admin/clients" },
  ];

  if (query.isPending) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[...breadcrumbs, { label: "Loading…" }]}
          title="Client"
        />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <LoadingSkeleton variant="card" rows={2} label="Loading client…" />
            <LoadingSkeleton variant="list" rows={3} label="Loading members…" />
          </div>
          <LoadingSkeleton variant="card" rows={3} label="Loading details…" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[...breadcrumbs, { label: "Client" }]}
          title="Client"
        />
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          backTo={{ to: "/admin/clients", label: "Clients" }}
        />
      </div>
    );
  }

  const client = query.data;
  const paymentConfirmed = client.paymentConfirmedAt !== null;
  const hasPortalAccess = client.portalAccessEnabledAt !== null;

  return (
    <div>
      <PageHeader
        breadcrumbs={[...breadcrumbs, { label: client.companyName }]}
        title={client.companyName}
        subtitle="Client workspace — payment, portal access, and members"
        actions={
          <Button variant="secondary" onClick={() => setIsEditOpen(true)}>
            <Pencil aria-hidden="true" />
            Edit client
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
        {/* ----- Main column ----- */}
        <div className="min-w-0 space-y-6">
          <CompanyInfoCard client={client} />
          <MembersCard client={client} />
          <ClientRequisitionsCard clientId={client.id} />
        </div>

        {/* ----- Sticky right rail (05 §4.1) ----- */}
        <div className="space-y-6 self-start xl:sticky xl:top-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ClientStatusBadge status={client.status} />
              <dl>
                <InfoRow
                  label="Service tier"
                  value={
                    client.serviceTier === null
                      ? "Not set"
                      : SERVICE_TIER_LABELS[client.serviceTier]
                  }
                />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {paymentConfirmed ? (
                <dl>
                  <InfoRow
                    label="Confirmed"
                    value={formatDate(client.paymentConfirmedAt)}
                  />
                  <InfoRow
                    label="Invoice ref"
                    value={client.invoiceReference ?? "—"}
                  />
                </dl>
              ) : (
                <p className="text-sm text-neutral-500">
                  Payment has not been confirmed yet. Portal access is locked
                  until it is.
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => setIsPaymentOpen(true)}
              >
                <CircleDollarSign aria-hidden="true" />
                {paymentConfirmed ? "Update payment" : "Confirm payment"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Portal access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasPortalAccess ? (
                <>
                  <p className="text-sm text-success-text">
                    Enabled {formatDateTime(client.portalAccessEnabledAt)}
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => setIsRevokeOpen(true)}
                  >
                    <ShieldOff aria-hidden="true" />
                    Revoke access
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-neutral-500">
                    {paymentConfirmed
                      ? "Payment is confirmed — the portal can be opened to this client."
                      : "Confirm payment first, then invite the primary contact."}
                  </p>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => setIsGrantOpen(true)}
                  >
                    <KeyRound aria-hidden="true" />
                    Grant access
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <InternalNotesCard client={client} />
          <EventLogCard
            events={eventsQuery.data}
            isLoading={eventsQuery.isPending}
            isError={eventsQuery.isError}
            error={eventsQuery.error}
            onRetry={() => void eventsQuery.refetch()}
            emptyDescription="Every state change on this client is recorded here."
          />
        </div>
      </div>

      <EditClientSheet
        client={client}
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
      />
      <ConfirmPaymentDialog
        client={client}
        open={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        onConfirmed={() => {
          // Funnel continuation (J2): a freshly paid client's next step is
          // portal access — open the grant dialog straight from success.
          if (!hasPortalAccess) {
            toast.success("Payment confirmed. Grant portal access now?");
            setIsGrantOpen(true);
          } else {
            toast.success("Payment updated.");
          }
        }}
      />
      <GrantAccessDialog
        client={client}
        open={isGrantOpen}
        onClose={() => setIsGrantOpen(false)}
      />
      <TypedConfirmDialog
        open={isRevokeOpen}
        onClose={() => setIsRevokeOpen(false)}
        title={`Revoke portal access for ${client.companyName}?`}
        description="Every member of this client is deactivated and can no longer sign in. Their data is kept."
        confirmName={client.companyName}
        confirmLabel="Revoke access"
        pendingLabel="Revoking…"
        onConfirm={async () => {
          const result = await revokeAccess.mutateAsync({ id: client.id });
          toast.success(
            `Access revoked. ${result.deactivatedUserIds.length} user${
              result.deactivatedUserIds.length === 1 ? "" : "s"
            } deactivated.`,
          );
        }}
      />
    </div>
  );
}
