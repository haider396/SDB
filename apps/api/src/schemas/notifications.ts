/**
 * API-local response envelopes for the admin notification log (06 §4.3
 * "Admin UI exposes a notification log view with a manual resend action"),
 * built from @sdb/contracts. Shared by route validation and OpenAPI.
 */
import {
  CollectionResponseSchema,
  NotificationLogRowSchema,
  ResendResponseSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const NotificationCollectionSchema = CollectionResponseSchema(
  NotificationLogRowSchema,
);

export const ResendEnvelopeSchema = SingleResponseSchema(ResendResponseSchema);
