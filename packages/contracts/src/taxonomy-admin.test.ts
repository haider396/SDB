import { describe, expect, it } from 'vitest';
import {
  CreateDepartmentBodySchema,
  CreateDisqualifierBodySchema,
  CreateIndustryBodySchema,
  CreateRejectionReasonBodySchema,
  CreateRoleCategoryBodySchema,
  CreateToolBodySchema,
  DepartmentSchema,
  DisqualifierSchema,
  EngineSchema,
  IndustrySchema,
  ListRejectionReasonsQuerySchema,
  ListRoleCategoriesQuerySchema,
  RejectionReasonSchema,
  RoleCategorySchema,
  SkillSchema,
  TaxonomyKeySchema,
  ToolSchema,
  UpdateDepartmentBodySchema,
  UpdateEngineBodySchema,
  UpdateRejectionReasonBodySchema,
  UpdateRoleCategoryBodySchema,
} from './taxonomy-admin.js';

const UUID = '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b';

describe('TaxonomyKeySchema', () => {
  it('accepts snake_case slugs', () => {
    expect(TaxonomyKeySchema.safeParse('client_experience').success).toBe(true);
    expect(TaxonomyKeySchema.safeParse('ops2_team').success).toBe(true);
  });

  it('rejects non-slug keys', () => {
    expect(TaxonomyKeySchema.safeParse('Client Experience').success).toBe(false);
    expect(TaxonomyKeySchema.safeParse('2starts_with_digit').success).toBe(false);
    expect(TaxonomyKeySchema.safeParse('').success).toBe(false);
  });
});

describe('EngineSchema / UpdateEngineBodySchema', () => {
  it('parses a full engine row', () => {
    const result = EngineSchema.safeParse({
      id: UUID,
      key: 'operations',
      label: 'Operations',
      description: 'The systems and structure…',
      isStaffed: true,
      sortOrder: 4,
      isActive: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts only label, isStaffed, sortOrder in the PATCH body', () => {
    expect(
      UpdateEngineBodySchema.safeParse({
        label: 'Ops',
        isStaffed: false,
        sortOrder: 9,
      }).success,
    ).toBe(true);
  });

  it('rejects any other field — engines are fixed (04 §5)', () => {
    expect(UpdateEngineBodySchema.safeParse({ key: 'new_key' }).success).toBe(false);
    expect(UpdateEngineBodySchema.safeParse({ description: 'x' }).success).toBe(false);
    expect(UpdateEngineBodySchema.safeParse({ isActive: false }).success).toBe(false);
    expect(
      UpdateEngineBodySchema.safeParse({ label: 'Ops', key: 'sneaky' }).success,
    ).toBe(false);
  });

  it('rejects an empty PATCH body', () => {
    expect(UpdateEngineBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('Department contracts', () => {
  it('parses a department row', () => {
    expect(
      DepartmentSchema.safeParse({
        id: UUID,
        engineId: UUID,
        key: 'marketing',
        label: 'Marketing',
        managerUserId: null,
        sortOrder: 1,
        isActive: true,
      }).success,
    ).toBe(true);
  });

  it('create requires engineId and label; key is optional (auto-slug)', () => {
    expect(
      CreateDepartmentBodySchema.safeParse({ engineId: UUID, label: 'Marketing' })
        .success,
    ).toBe(true);
    expect(CreateDepartmentBodySchema.safeParse({ label: 'Marketing' }).success).toBe(
      false,
    );
  });

  it('update requires at least one field and allows isActive reactivation', () => {
    expect(UpdateDepartmentBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateDepartmentBodySchema.safeParse({ isActive: true }).success).toBe(true);
  });
});

describe('Role-category contracts', () => {
  it('parses a role-category row', () => {
    expect(
      RoleCategorySchema.safeParse({
        id: UUID,
        departmentId: UUID,
        key: 'va_admin',
        label: 'Virtual Assistant',
        advertisedTitle: 'Executive Assistant',
        description: null,
        sortOrder: 1,
        isActive: true,
      }).success,
    ).toBe(true);
  });

  it('create requires departmentId and label', () => {
    expect(
      CreateRoleCategoryBodySchema.safeParse({
        departmentId: UUID,
        label: 'Virtual Assistant',
      }).success,
    ).toBe(true);
    expect(
      CreateRoleCategoryBodySchema.safeParse({ label: 'Virtual Assistant' }).success,
    ).toBe(false);
  });

  it('update requires at least one field', () => {
    expect(UpdateRoleCategoryBodySchema.safeParse({}).success).toBe(false);
    expect(
      UpdateRoleCategoryBodySchema.safeParse({ advertisedTitle: null }).success,
    ).toBe(true);
  });

  it('list query coerces isActive and accepts engineId/departmentId', () => {
    const parsed = ListRoleCategoriesQuerySchema.parse({
      engineId: UUID,
      isActive: 'false',
    });
    expect(parsed.isActive).toBe(false);
    expect(parsed.engineId).toBe(UUID);
  });
});

describe('Reference-data contracts (tools, skills, industries)', () => {
  it('tools and skills share a shape with nullable category', () => {
    const row = { id: UUID, name: 'HubSpot', category: 'CRM', isActive: true };
    expect(ToolSchema.safeParse(row).success).toBe(true);
    expect(SkillSchema.safeParse({ ...row, category: null }).success).toBe(true);
  });

  it('industries have no category', () => {
    expect(
      IndustrySchema.safeParse({ id: UUID, name: 'Legal', isActive: true }).success,
    ).toBe(true);
  });

  it('create bodies require name only', () => {
    expect(CreateToolBodySchema.safeParse({ name: 'Slack' }).success).toBe(true);
    expect(
      CreateToolBodySchema.safeParse({ name: 'Slack', category: 'Comms' }).success,
    ).toBe(true);
    expect(CreateIndustryBodySchema.safeParse({ name: 'Legal' }).success).toBe(true);
    expect(CreateIndustryBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('Disqualifier contracts', () => {
  it('parses a row with a null roleCategoryId (global)', () => {
    expect(
      DisqualifierSchema.safeParse({
        id: UUID,
        key: 'no_english',
        label: 'No professional English',
        roleCategoryId: null,
        sortOrder: 1,
        isActive: true,
      }).success,
    ).toBe(true);
  });

  it('create requires label only', () => {
    expect(
      CreateDisqualifierBodySchema.safeParse({ label: 'No professional English' })
        .success,
    ).toBe(true);
    expect(CreateDisqualifierBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('Rejection-reason contracts', () => {
  it('parses a seeded row', () => {
    expect(
      RejectionReasonSchema.safeParse({
        id: UUID,
        key: 'skills_gap',
        label: 'Skills gap',
        actor: 'client',
        sortOrder: 1,
        isActive: true,
      }).success,
    ).toBe(true);
  });

  it('create REQUIRES actor (client/admin)', () => {
    expect(
      CreateRejectionReasonBodySchema.safeParse({
        label: 'Skills gap',
        actor: 'client',
      }).success,
    ).toBe(true);
    expect(
      CreateRejectionReasonBodySchema.safeParse({ label: 'Skills gap' }).success,
    ).toBe(false);
    expect(
      CreateRejectionReasonBodySchema.safeParse({
        label: 'Skills gap',
        actor: 'system',
      }).success,
    ).toBe(false);
  });

  it('update accepts key (the API answers a change with 422) and needs one field', () => {
    expect(UpdateRejectionReasonBodySchema.safeParse({}).success).toBe(false);
    expect(
      UpdateRejectionReasonBodySchema.safeParse({ key: 'skills_gap' }).success,
    ).toBe(true);
  });

  it('list query filters by actor', () => {
    expect(ListRejectionReasonsQuerySchema.parse({ actor: 'admin' }).actor).toBe(
      'admin',
    );
    expect(ListRejectionReasonsQuerySchema.safeParse({ actor: 'nobody' }).success).toBe(
      false,
    );
  });
});
