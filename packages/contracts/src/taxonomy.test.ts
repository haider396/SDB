import { describe, expect, it } from 'vitest';
import { PublicTaxonomySchema } from './taxonomy.js';

const UUID = '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b';

describe('PublicTaxonomySchema', () => {
  it('accepts the engines → departments → roleCategories cascade', () => {
    const result = PublicTaxonomySchema.safeParse({
      engines: [
        {
          id: UUID,
          key: 'operations',
          label: 'Operations',
          description: 'The systems and structure that keep the business moving',
          departments: [
            {
              id: UUID,
              key: 'executive_assistance',
              label: 'Executive Assistance',
              roleCategories: [
                {
                  id: UUID,
                  key: 'executive_assistant',
                  label: 'Executive Assistant',
                  advertisedTitle: 'Executive Assistant',
                  description: 'Calendar, inbox, travel, and founder support',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a role category missing its id', () => {
    expect(
      PublicTaxonomySchema.safeParse({
        engines: [
          {
            id: UUID,
            key: 'operations',
            label: 'Operations',
            description: null,
            departments: [
              {
                id: UUID,
                key: 'd',
                label: 'D',
                roleCategories: [
                  { key: 'x', label: 'X', advertisedTitle: null, description: null },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
