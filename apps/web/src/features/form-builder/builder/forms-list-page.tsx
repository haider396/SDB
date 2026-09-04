/**
 * /admin/forms — every candidate form, with its status and public link.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Copy, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { CandidateFormSummary } from "@sdb/contracts";
import { DataTable } from "@/components/patterns/data-table";
import { PageHeader } from "@/components/patterns/page-header";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { usePageTitle } from "@/lib/use-page-title";
import { roleCategoryChoices, useTaxonomy } from "@/features/question-manager/api";
import { useCreateForm, useDeleteFormById, useFormList } from "../api";

function statusChip(status: CandidateFormSummary["status"]) {
  if (status === "active") return <Chip tone="success" size="sm">Live</Chip>;
  if (status === "draft") return <Chip tone="neutral" size="sm">Draft</Chip>;
  return <Chip tone="warning" size="sm">Off</Chip>;
}

function buildColumns(
  onDelete: (form: CandidateFormSummary) => void,
): ColumnDef<CandidateFormSummary, unknown>[] {
  return [
    {
      id: "label",
      accessorKey: "label",
      header: "Form",
      cell: ({ row }) => (
        <span className="font-medium text-brand-navy-ink">
          {row.original.label}
        </span>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => (
        <span className="text-sm text-neutral-600">
          {row.original.roleCategory?.label ?? "General"}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => statusChip(row.original.status),
    },
    {
      id: "link",
      header: "Public link",
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <button
            type="button"
            aria-label={`Copy the link for ${row.original.label}`}
            className="inline-flex items-center gap-1 text-xs text-brand-blue underline"
            onClick={(event) => {
              // The row is a link; copying must not also navigate.
              event.stopPropagation();
              event.preventDefault();
              void navigator.clipboard?.writeText(
                `${window.location.origin}${row.original.publicPath}`,
              );
              toast.success("Public link copied.");
            }}
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            {row.original.publicPath}
          </button>
        ) : (
          <span className="text-xs text-neutral-400">Not live</span>
        ),
    },
    {
      id: "submissions",
      accessorKey: "submissionCount",
      header: "Submissions",
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.submissionCount}</span>
      ),
    },
    {
      id: "actions",
      // The header is visually empty but must still be announced.
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        // The seeded registration form is refused server-side, so do not
        // offer the action for it either.
        row.original.isDefault ? null : (
          <button
            type="button"
            aria-label={`Delete ${row.original.label}`}
            className="rounded-sm p-1 text-neutral-400 hover:bg-danger-subtle hover:text-danger-text"
            onClick={(event) => {
              // The whole row is a link to the builder; deleting must not
              // also navigate into the form being deleted.
              event.stopPropagation();
              event.preventDefault();
              onDelete(row.original);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ),
    },
  ];
}

export function FormsListPage() {
  const navigate = useNavigate();
  const listQuery = useFormList();
  const create = useCreateForm();
  const remove = useDeleteFormById();
  const [open, setOpen] = useState(false);
  // One dialog serves every row; the pending form is what it is armed against.
  const [pendingDelete, setPendingDelete] = useState<CandidateFormSummary | null>(
    null,
  );
  const columns = useMemo(() => buildColumns(setPendingDelete), []);
  usePageTitle("Forms");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Candidate forms"
        subtitle="Build a form, turn it on, and share its link with candidates."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            New form
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={listQuery.data ?? []}
        label="Candidate forms"
        isLoading={listQuery.isPending}
        isError={listQuery.isError}
        error={listQuery.error}
        onRetry={() => void listQuery.refetch()}
        getRowHref={(row) => `/admin/forms/${row.id}`}
        empty={{
          icon: LayoutTemplate,
          title: "No forms yet",
          description:
            "A form collects candidate details at a public link you can share.",
          action: <Button onClick={() => setOpen(true)}>New form</Button>,
        }}
      />

      <TypedConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={`Delete "${pendingDelete?.label ?? ""}"?`}
        description={
          <>
            The form is removed from this list and its public link stops working.
            Submissions already made are kept on the candidates who made them.
            {pendingDelete?.status === "active" ? (
              <strong className="mt-2 block text-danger-text">
                This form is live. Open it and turn it off first — a link people
                may be filling in right now cannot be deleted.
              </strong>
            ) : null}
          </>
        }
        confirmName={pendingDelete?.label ?? ""}
        confirmLabel="Delete form"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (pendingDelete === null) return;
          await remove.mutateAsync(pendingDelete.id);
          setPendingDelete(null);
          toast.success(`"${pendingDelete.label}" deleted.`);
        }}
      />

      <NewFormDialog
        // Remount on open so the "start from" default is chosen against the
        // LOADED template list. A useState initialiser runs once, on first
        // render, when the list is still undefined — which silently left the
        // dialog defaulting to a blank form.
        key={open ? "open" : "closed"}
        open={open}
        onOpenChange={setOpen}
        templates={listQuery.data ?? []}
        onCreate={async (body) => {
          const created = await create.mutateAsync(body);
          setOpen(false);
          navigate(`/admin/forms/${created.id}`);
        }}
      />
    </div>
  );
}

function NewFormDialog({
  open,
  onOpenChange,
  templates,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: CandidateFormSummary[];
  onCreate: (body: {
    key: string;
    label: string;
    roleCategoryId: string;
    templateFormId?: string;
  }) => Promise<void>;
}) {
  const taxonomy = useTaxonomy();
  const choices = roleCategoryChoices(taxonomy.data);
  const [label, setLabel] = useState("");
  const [roleCategoryId, setRoleCategoryId] = useState("");
  // Default to the seeded registration form: starting from the standard
  // question set is the common case, and a blank canvas is the exception.
  const [templateFormId, setTemplateFormId] = useState(
    () => templates.find((form) => form.isDefault)?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (label.trim() === "" || roleCategoryId === "") {
      setError("Give the form a name and choose the role it is for.");
      return;
    }
    try {
      await onCreate({
        // A stable machine key derived from the name. Immutable afterwards,
        // which is why it is derived once here rather than edited later.
        key: label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .slice(0, 90),
        label: label.trim(),
        roleCategoryId,
        ...(templateFormId === "" ? {} : { templateFormId }),
      });
      setLabel("");
      setRoleCategoryId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the form.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New candidate form</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-form-label">Form name</Label>
            <Input
              id="new-form-label"
              value={label}
              placeholder="Video Editor"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-form-template">Start from</Label>
            <NativeSelect
              id="new-form-template"
              value={templateFormId}
              onChange={(event) => setTemplateFormId(event.target.value)}
            >
              <option value="">A blank form</option>
              {templates.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.label}
                  {form.isDefault ? " (standard questions)" : ""}
                </option>
              ))}
            </NativeSelect>
            <p className="text-2xs text-neutral-500">
              A copy is made, so the form you start from is never changed.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-form-role">Role</Label>
            <NativeSelect
              id="new-form-role"
              value={roleCategoryId}
              onChange={(event) => setRoleCategoryId(event.target.value)}
            >
              <option value="">Choose a role…</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.pathLabel}
                </option>
              ))}
            </NativeSelect>
            <p className="text-2xs text-neutral-500">
              Anyone applying through this form is tagged with that role.
            </p>
          </div>
          {error !== null ? (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
