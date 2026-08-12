/**
 * /admin/notifications — the outbound notification log (06 §4.3): every
 * GoHighLevel dispatch with status, attempts, and last error; status/event
 * filters held in the URL; per-row payload inspection in a sheet; and a
 * manual Resend action on failed rows, visible only with settings.manage
 * (the API enforces it — the UI merely does not offer what would 403).
 */
import type { ColumnDef } from "@tanstack/react-table";
import { BellOff, Eye, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type {
  NotificationEvent,
  NotificationLogRow,
  NotificationStatus,
} from "@sdb/contracts";
import {
  NotificationEventSchema,
  NotificationStatusSchema,
} from "@sdb/contracts";
import {
  DataTable,
  type DataTableColumnMeta,
} from "@/components/patterns/data-table";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useNotifications, useResendNotification } from "./api";
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_STATUS_LABELS,
} from "./labels";

const STATUS_CLASSES: Record<NotificationStatus, string> = {
  queued: "text-neutral-600 bg-neutral-100",
  sent: "text-success-text bg-success-subtle",
  failed: "text-danger-text bg-danger-subtle",
};

function NotificationStatusBadge({ status }: { status: NotificationStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_CLASSES[status],
      )}
    >
      {NOTIFICATION_STATUS_LABELS[status]}
    </span>
  );
}

function meta(value: DataTableColumnMeta): DataTableColumnMeta {
  return value;
}

export function NotificationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedStatus = NotificationStatusSchema.safeParse(
    searchParams.get("status"),
  );
  const status: NotificationStatus | undefined = parsedStatus.success
    ? parsedStatus.data
    : undefined;
  const parsedEvent = NotificationEventSchema.safeParse(
    searchParams.get("event"),
  );
  const event: NotificationEvent | undefined = parsedEvent.success
    ? parsedEvent.data
    : undefined;

  const query = useNotifications({ status, event });
  const resend = useResendNotification();
  // POST :id/resend is settings.manage (super_admin) — hide it otherwise.
  const { allowed: canResend } = useCan("settings.manage");

  const [payloadRow, setPayloadRow] = useState<NotificationLogRow | null>(null);

  const rows = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.data),
    [query.data],
  );

  const setParam = (key: string, value: string | null) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const onResend = (row: NotificationLogRow) => {
    resend.mutate(
      { id: row.id },
      {
        onSuccess: (fresh) => {
          if (fresh.status === "sent") {
            toast.success(`Notification to ${fresh.recipientEmail} was resent.`);
          } else {
            toast.error(
              `Resend attempted, but the notification is ${NOTIFICATION_STATUS_LABELS[fresh.status].toLowerCase()}${fresh.lastError !== null ? ` — ${fresh.lastError}` : ""}.`,
            );
          }
        },
        onError: (error) => {
          toast.error(
            error instanceof ApiError
              ? error.message
              : "The resend request failed.",
          );
        },
      },
    );
  };

  // Rebuilt per render on purpose: the actions column closes over the
  // resend mutation and the permission flag; table state lives elsewhere.
  const columns: ColumnDef<NotificationLogRow, unknown>[] = [
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <NotificationStatusBadge status={row.original.status} />,
      },
      {
        id: "event",
        accessorKey: "event",
        header: "Event",
        cell: ({ row }) => NOTIFICATION_EVENT_LABELS[row.original.event],
      },
      {
        id: "recipientEmail",
        accessorKey: "recipientEmail",
        header: "Recipient",
        cell: ({ row }) => (
          <span className="font-medium text-brand-navy-ink">
            {row.original.recipientEmail}
          </span>
        ),
      },
      {
        id: "attempts",
        accessorKey: "attempts",
        header: "Attempts",
        meta: meta({ numeric: true }),
      },
      {
        id: "lastError",
        accessorKey: "lastError",
        header: "Last error",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.lastError === null ? (
            "—"
          ) : (
            <span
              title={row.original.lastError}
              className="inline-block max-w-64 truncate align-middle text-danger-text"
            >
              {row.original.lastError}
            </span>
          ),
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "Created",
        meta: meta({ numeric: true }),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: "sentAt",
        accessorKey: "sentAt",
        header: "Sent at",
        meta: meta({ numeric: true }),
        cell: ({ row }) => formatDateTime(row.original.sentAt),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPayloadRow(row.original)}
            >
              <Eye aria-hidden="true" />
              Payload
              <span className="sr-only">
                {" "}
                of the {NOTIFICATION_EVENT_LABELS[row.original.event]}{" "}
                notification to {row.original.recipientEmail}
              </span>
            </Button>
            {canResend && row.original.status === "failed" ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={resend.isPending}
                onClick={() => onResend(row.original)}
              >
                <RotateCw aria-hidden="true" />
                Resend
                <span className="sr-only"> to {row.original.recipientEmail}</span>
              </Button>
            ) : null}
          </span>
        ),
      },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Admin", to: "/admin" },
          { label: "Notifications" },
        ]}
        title="Notifications"
        subtitle="Outbound GoHighLevel dispatch log — queued, sent, and failed sends"
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-48 space-y-1.5">
          <Label htmlFor="notifications-status">Status</Label>
          <NativeSelect
            id="notifications-status"
            value={status ?? ""}
            onChange={(changeEvent) =>
              setParam("status", changeEvent.target.value)
            }
          >
            <option value="">All statuses</option>
            {NotificationStatusSchema.options.map((value) => (
              <option key={value} value={value}>
                {NOTIFICATION_STATUS_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-64 space-y-1.5">
          <Label htmlFor="notifications-event">Event</Label>
          <NativeSelect
            id="notifications-event"
            value={event ?? ""}
            onChange={(changeEvent) =>
              setParam("event", changeEvent.target.value)
            }
          >
            <option value="">All events</option>
            {NotificationEventSchema.options.map((value) => (
              <option key={value} value={value}>
                {NOTIFICATION_EVENT_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        label="Notification log"
        isLoading={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{
          icon: BellOff,
          title: "No notifications yet",
          description:
            status !== undefined || event !== undefined
              ? "No notifications match these filters. Clear them to see the full log."
              : "Outbound notifications appear here as portal activity triggers them.",
        }}
        onLoadMore={() => void query.fetchNextPage()}
        hasMore={query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        footer={`${rows.length} notification${rows.length === 1 ? "" : "s"} loaded`}
      />

      <Sheet
        open={payloadRow !== null}
        onOpenChange={(open) => {
          if (!open) setPayloadRow(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {payloadRow !== null
                ? `${NOTIFICATION_EVENT_LABELS[payloadRow.event]} payload`
                : "Payload"}
            </SheetTitle>
            <SheetDescription>
              {payloadRow !== null
                ? `To ${payloadRow.recipientEmail} · ${formatDateTime(payloadRow.createdAt)}`
                : "The stored webhook body"}
            </SheetDescription>
          </SheetHeader>
          {payloadRow !== null ? (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <pre className="overflow-x-auto rounded-md bg-surface-subtle p-4 text-xs leading-relaxed text-neutral-800">
                {JSON.stringify(payloadRow.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
