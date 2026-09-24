/**
 * Change a member's role and/or principal flag (04 §6 PATCH member).
 */
import { useEffect, useState } from "react";
import type { ClientMember, ClientMemberRole } from "@sdb/contracts";
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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api-client";
import { useUpdateMember } from "../api";
import { MEMBER_ROLE_LABELS } from "./invite-member-dialog";

export function EditMemberDialog({
  clientId,
  member,
  onClose,
}: {
  clientId: string;
  member: ClientMember | null;
  onClose: () => void;
}) {
  const updateMember = useUpdateMember();
  const [role, setRole] = useState<ClientMemberRole>("client_user");
  const [isPrincipal, setIsPrincipal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member !== null) {
      setRole(member.role ?? "client_user");
      setIsPrincipal(member.isPrincipal);
      setError(null);
    }
  }, [member]);

  const submit = async () => {
    if (member === null) return;
    try {
      await updateMember.mutateAsync({
        clientId,
        userId: member.userId,
        body: { role, isPrincipal },
      });
      onClose();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not update the member.",
      );
    }
  };

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        {member !== null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit member</DialogTitle>
              <DialogDescription>
                {member.fullName} · {member.email}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="member-role">Access</Label>
                <NativeSelect
                  id="member-role"
                  value={role}
                  onChange={(event) =>
                    setRole(
                      ClientMemberRoleSchema.parse(event.target.value),
                    )
                  }
                >
                  {ClientMemberRoleSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {MEMBER_ROLE_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <label
                htmlFor="member-principal"
                className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
              >
                <input
                  id="member-principal"
                  type="checkbox"
                  className="h-4 w-4 accent-current"
                  checked={isPrincipal}
                  onChange={(event) => setIsPrincipal(event.target.checked)}
                />
                This person has authority to approve the brief
              </label>
              {error !== null ? (
                <p role="alert" className="text-xs text-danger-text">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMember.isPending}>
                {updateMember.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
