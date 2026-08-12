/**
 * Every permission key seeded in the database, exhaustive for MVP.
 * Source: docs/02-DATABASE.md §3 "Permission keys to seed".
 */
import { z } from 'zod';

export const PERMISSION_KEYS = [
  'client.view',
  'client.create',
  'client.update',
  'client.grant_access',
  'client.invite_user',
  'requisition.view',
  'requisition.create',
  'requisition.update',
  'requisition.transition',
  'requisition.approve_as_principal',
  'requisition.view_commercials',
  'candidate.view',
  'candidate.create',
  'candidate.update',
  'candidate.view_pii',
  'candidate.assign',
  'candidate.present',
  'candidate.reject',
  'assignment.view',
  'assignment.advance',
  'assignment.reject',
  'interview.view',
  'interview.create',
  'interview.update',
  'question.view',
  'question.manage',
  'settings.manage',
  'user.manage',
  'event.view',
] as const;

export const PermissionKeySchema = z.enum(PERMISSION_KEYS);
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
