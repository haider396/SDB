/**
 * /client/requisitions/new — the in-portal second-hire intake (03 §3.5,
 * 01 §3 J1 variant): the SAME form engine as the public /intake page, in
 * portal mode — authenticated fetches, company/contact answers prefilled
 * from the client record and rendered read-only, submission to
 * POST /requisitions, success → straight to the new requisition's detail.
 */
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useClientId } from "@/components/guards/require-client-context";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { useMe } from "@/lib/permissions";
import { useClient } from "@/features/clients/api";
import { IntakeForm } from "@/features/intake-form";

/**
 * Question keys prefilled from the account (03 §3.4 mapped keys plus the
 * website, which also lives on the client record). Only keys with a real
 * value are prefilled; anything absent stays editable.
 */
function buildPrefill(args: {
  companyName: string;
  website: string | null;
  contactName: string;
  contactEmail: string;
}): Record<string, string> {
  return {
    company_name: args.companyName,
    ...(args.website !== null && args.website !== ""
      ? { company_website: args.website }
      : {}),
    contact_name: args.contactName,
    contact_email: args.contactEmail,
  };
}

export function ClientRequisitionNewPage() {
  const navigate = useNavigate();
  const clientId = useClientId();
  const meQuery = useMe();
  const clientQuery = useClient(clientId);

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: "Dashboard", to: "/client" },
        { label: "My requisitions", to: "/client/requisitions" },
        { label: "Request a hire" },
      ]}
      title="Request another hire"
      subtitle="Same questions as your first request — your company details are already filled in"
    />
  );

  if (meQuery.isLoading || clientQuery.isLoading) {
    return (
      <>
        {header}
        <LoadingSkeleton variant="card" rows={3} label="Preparing the form…" />
      </>
    );
  }
  if (meQuery.isError || clientQuery.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={meQuery.isError ? meQuery.error : clientQuery.error}
          onRetry={() => {
            if (meQuery.isError) void meQuery.refetch();
            if (clientQuery.isError) void clientQuery.refetch();
          }}
        />
      </>
    );
  }
  const me = meQuery.data;
  const client = clientQuery.data;
  if (me === undefined || client === undefined) return header;

  const prefill = buildPrefill({
    companyName: client.companyName,
    website: client.website,
    contactName: me.user.fullName,
    contactEmail: me.user.email,
  });

  return (
    <>
      {header}
      <div className="mx-auto max-w-2xl">
        <IntakeForm
          mode="portal"
          prefill={prefill}
          onSubmitted={(result) => {
            toast.success(
              `Request ${result.requisitionReference} submitted.`,
            );
            navigate(`/client/requisitions/${result.id}`);
          }}
        />
      </div>
    </>
  );
}
