/**
 * API-local response envelopes for taxonomy management (04 §5), built from
 * @sdb/contracts schemas. Shared by route validation and OpenAPI generation.
 *
 * All lists are full plain arrays inside the standard collection envelope
 * (nextCursor always null): every taxonomy table is small reference data —
 * five engines, tens of departments/role categories/reasons — so cursor
 * pagination would be ceremony without benefit.
 */
import {
  CollectionResponseSchema,
  DepartmentSchema,
  DisqualifierSchema,
  EngineSchema,
  IndustrySchema,
  RejectionReasonSchema,
  RoleCategorySchema,
  SingleResponseSchema,
  SkillSchema,
  ToolSchema,
} from '@sdb/contracts';

export const EngineEnvelopeSchema = SingleResponseSchema(EngineSchema);
export const EngineCollectionSchema = CollectionResponseSchema(EngineSchema);

export const DepartmentEnvelopeSchema = SingleResponseSchema(DepartmentSchema);
export const DepartmentCollectionSchema =
  CollectionResponseSchema(DepartmentSchema);

export const RoleCategoryEnvelopeSchema =
  SingleResponseSchema(RoleCategorySchema);
export const RoleCategoryCollectionSchema =
  CollectionResponseSchema(RoleCategorySchema);

export const TaxonomyToolEnvelopeSchema = SingleResponseSchema(ToolSchema);
export const TaxonomyToolCollectionSchema = CollectionResponseSchema(ToolSchema);

export const TaxonomySkillEnvelopeSchema = SingleResponseSchema(SkillSchema);
export const TaxonomySkillCollectionSchema =
  CollectionResponseSchema(SkillSchema);

export const IndustryEnvelopeSchema = SingleResponseSchema(IndustrySchema);
export const IndustryCollectionSchema = CollectionResponseSchema(IndustrySchema);

export const DisqualifierEnvelopeSchema =
  SingleResponseSchema(DisqualifierSchema);
export const DisqualifierCollectionSchema =
  CollectionResponseSchema(DisqualifierSchema);

export const RejectionReasonEnvelopeSchema =
  SingleResponseSchema(RejectionReasonSchema);
export const RejectionReasonCollectionSchema =
  CollectionResponseSchema(RejectionReasonSchema);
