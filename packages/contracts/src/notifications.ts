/**
 * Notification dispatch contracts (docs/06-BACKEND.md §4, P7).
 *
 * - `NotificationPayloadSchema` — the outbound GoHighLevel webhook body
 *   (06 §4.1): identical shape for every event, every field a template might
 *   need present even when a given workflow does not use it.
 * - `NotificationLogRowSchema` — one `notification_log` row as surfaced by
 *   the admin log view (`GET /admin/notifications`).
 * - `ListNotificationsQuerySchema` — status/event filters + cursor pagination.
 * - `ResendResponseSchema` — the row after a manual re-queue + immediate
 *   dispatch attempt (06 §4.3 "manual resend action").
 */
import { z } from 'zod';
import { NotificationEventSchema } from './enums.js';

const isoTimestamp = z.string().datetime({ offset: true });

/** notification_log.status — queued|sent|failed (migration 0009). */
export const NotificationStatusSchema = z.enum(['queued', 'sent', 'failed']);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

/** Outbound recipient block (06 §4.1). */
export const NotificationRecipientSchema = z.object({
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  userId: z.string().uuid().nullable(),
});
export type NotificationRecipient = z.infer<typeof NotificationRecipientSchema>;

/**
 * Outbound context block (06 §4.1). The six documented merge fields are
 * always present (null when not applicable to the event); event-specific
 * extras (decision, fromStatus, toStatus, interviewId, ...) pass through.
 */
export const NotificationContextSchema = z
  .object({
    clientName: z.string().nullable(),
    requisitionReference: z.string().nullable(),
    roleTitle: z.string().nullable(),
    candidateCount: z.number().int().nonnegative().nullable(),
    actionUrl: z.string().url().nullable(),
    actorName: z.string().nullable(),
  })
  .catchall(z.unknown());
export type NotificationContext = z.infer<typeof NotificationContextSchema>;

/** The full webhook body POSTed to `GHL_WEBHOOK_URL_<EVENT>` (06 §4.1). */
export const NotificationPayloadSchema = z.object({
  event: NotificationEventSchema,
  recipient: NotificationRecipientSchema,
  context: NotificationContextSchema,
  /** Null while queued; set to the dispatch instant on the outbound body. */
  sentAt: isoTimestamp.nullable(),
  notificationLogId: z.string().uuid(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

/** One `notification_log` row (admin log view, 06 §4.3). */
export const NotificationLogRowSchema = z.object({
  id: z.string().uuid(),
  event: NotificationEventSchema,
  recipientEmail: z.string(),
  recipientUserId: z.string().uuid().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  /** The stored payload: enqueue shape before dispatch, outbound body after. */
  payload: z.record(z.unknown()),
  provider: z.string(),
  providerResponse: z.unknown().nullable(),
  status: NotificationStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: isoTimestamp,
  sentAt: isoTimestamp.nullable(),
});
export type NotificationLogRow = z.infer<typeof NotificationLogRowSchema>;

/** `GET /admin/notifications` — filters + cursor pagination (04 §1). */
export const ListNotificationsQuerySchema = z.object({
  status: NotificationStatusSchema.optional(),
  event: NotificationEventSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * `POST /admin/notifications/:id/resend` — the row after the re-queue and
 * the immediate dispatch attempt it triggers (so status reflects the result).
 */
export const ResendResponseSchema = NotificationLogRowSchema;
export type ResendResponse = z.infer<typeof ResendResponseSchema>;
