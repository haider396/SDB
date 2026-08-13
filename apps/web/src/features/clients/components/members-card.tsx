/**
 * Members table for the client detail page: dense rows with role, principal
 * and primary-contact markers, invitation state, and row actions (edit role /
 * remove). Removal is a typed-name destructive confirm (AC-UI-10); the API's
 * last-client_admin rejection surfaces inline in that dialog.
 */
import { Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import type { Client, ClientMember } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useClientMembers, useRemoveMember } from "../api";
import { EditMemberDialog } from "./edit-member-dialog";
import { InviteMemberDialog, MEMBER_ROLE_LABELS } from "./invite-member-dialog";

export function MembersCard({ client }: { client: Client }) {
  const membersQuery = useClientMembers(client.id);
  const removeMember = useRemoveMember();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [editing, setEditing] = useState<ClientMember | null>(null);
  const [removing, setRemoving] = useState<ClientMember | null>(null);

  const members = membersQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Members</CardTitle>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsInviteOpen(true)}
        >
          <UserPlus aria-hidden="true" />
          Invite member
        </Button>
      </CardHeader>
      <CardContent>
        {membersQuery.isPending ? (
          <LoadingSkeleton variant="list" rows={3} label="Loading members…" />
        ) : membersQuery.isError ? (
          <ErrorState
            error={membersQuery.error}
            onRetry={() => void membersQuery.refetch()}
          />
        ) : members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No members yet"
            description="People invited to this client's portal appear here. Grant access to create the first member, or invite one directly."
            action={
              <Button variant="secondary" onClick={() => setIsInviteOpen(true)}>
                <UserPlus aria-hidden="true" />
                Invite member
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" aria-label="Members">
              <thead>
                <tr className="border-b border-border-default">
                  <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Name
                  </th>
                  <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Role
                  </th>
                  <th scope="col" className="h-10 px-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Status
                  </th>
                  <th scope="col" className="h-10 px-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-neutral-200 last:border-b-0"
                  >
                    <td className="h-10 px-3">
                      <div className="flex flex-col py-1">
                        <span className="font-medium text-brand-navy-ink">
                          {member.fullName}
                          {member.isPrimaryContact ? (
                            <span className="ml-2 rounded-full bg-brand-blue-subtle px-2 py-0.5 text-xs font-medium text-brand-blue">
                              Primary contact
                            </span>
                          ) : null}
                          {member.isPrincipal ? (
                            <span className="ml-2 rounded-full bg-info-subtle px-2 py-0.5 text-xs font-medium text-info">
                              Principal
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {member.email}
                          {member.jobTitle !== null
                            ? ` · ${member.jobTitle}`
                            : ""}
                        </span>
                      </div>
                    </td>
                    <td className="h-10 whitespace-nowrap px-3 text-neutral-800">
                      {member.role === null
                        ? "—"
                        : MEMBER_ROLE_LABELS[member.role]}
                    </td>
                    <td className="h-10 whitespace-nowrap px-3 text-neutral-800">
                      {!member.isActive ? (
                        <span className="text-neutral-500">Deactivated</span>
                      ) : member.acceptedAt !== null ? (
                        <span className="text-success-text">
                          Accepted {formatDate(member.acceptedAt)}
                        </span>
                      ) : member.invitedAt !== null ? (
                        <span className="text-warning-text">
                          Invited {formatDate(member.invitedAt)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="h-10 whitespace-nowrap px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${member.fullName}`}
                          onClick={() => setEditing(member)}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${member.fullName}`}
                          onClick={() => setRemoving(member)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <InviteMemberDialog
        client={client}
        open={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
      />
      <EditMemberDialog
        clientId={client.id}
        member={editing}
        onClose={() => setEditing(null)}
      />
      <TypedConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.fullName ?? "member"}?`}
        description="They lose access to this client's portal. Their past activity is kept. This cannot be undone from the portal."
        confirmName={removing?.fullName ?? ""}
        confirmLabel="Remove member"
        pendingLabel="Removing…"
        onConfirm={async () => {
          if (removing === null) return;
          await removeMember.mutateAsync({
            clientId: client.id,
            userId: removing.userId,
          });
        }}
        mapError={(error) =>
          // AC-AUTH-07 guard: the API rejects removing the last client_admin.
          error.code === "VALIDATION_FAILED" &&
          error.message.toLowerCase().includes("last client admin")
            ? "This is the last client admin for this client, so they cannot be removed. Promote another member to client admin first."
            : null
        }
      />
    </Card>
  );
}
