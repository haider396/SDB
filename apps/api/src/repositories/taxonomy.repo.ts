/**
 * SQL for the public taxonomy cascade (docs/04-API.md §3): active staffed
 * engines → active departments → active role categories.
 */
import type { PublicTaxonomy } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

interface TaxonomyRow {
  engine_id: string;
  engine_key: string;
  engine_label: string;
  engine_description: string | null;
  department_id: string | null;
  department_key: string | null;
  department_label: string | null;
  role_category_id: string | null;
  role_category_key: string | null;
  role_category_label: string | null;
  advertised_title: string | null;
  role_category_description: string | null;
}

export async function getPublicTaxonomy(
  sql: Queryable,
): Promise<PublicTaxonomy> {
  const rows = await sql<TaxonomyRow[]>`
    select e.id  as engine_id,  e.key  as engine_key,
           e.label as engine_label, e.description as engine_description,
           d.id  as department_id, d.key as department_key, d.label as department_label,
           rc.id as role_category_id, rc.key as role_category_key,
           rc.label as role_category_label, rc.advertised_title,
           rc.description as role_category_description
    from engines e
    left join departments d
      on d.engine_id = e.id and d.is_active
    left join role_categories rc
      on rc.department_id = d.id and rc.is_active
    where e.is_active and e.is_staffed
    order by e.sort_order, e.id, d.sort_order, d.id, rc.sort_order, rc.id
  `;

  const engines: PublicTaxonomy['engines'] = [];
  const engineIndex = new Map<string, number>();
  const departmentIndex = new Map<string, number>();

  for (const row of rows) {
    let engineIdx = engineIndex.get(row.engine_id);
    if (engineIdx === undefined) {
      engineIdx = engines.length;
      engineIndex.set(row.engine_id, engineIdx);
      engines.push({
        id: row.engine_id,
        key: row.engine_key,
        label: row.engine_label,
        description: row.engine_description,
        departments: [],
      });
    }
    const engine = engines[engineIdx];
    if (engine === undefined || row.department_id === null) continue;

    const departmentMapKey = `${row.engine_id}:${row.department_id}`;
    let departmentIdx = departmentIndex.get(departmentMapKey);
    if (departmentIdx === undefined) {
      departmentIdx = engine.departments.length;
      departmentIndex.set(departmentMapKey, departmentIdx);
      engine.departments.push({
        id: row.department_id,
        key: row.department_key ?? '',
        label: row.department_label ?? '',
        roleCategories: [],
      });
    }
    const department = engine.departments[departmentIdx];
    if (department === undefined || row.role_category_id === null) continue;

    department.roleCategories.push({
      id: row.role_category_id,
      key: row.role_category_key ?? '',
      label: row.role_category_label ?? '',
      advertisedTitle: row.advertised_title,
      description: row.role_category_description,
    });
  }

  return { engines };
}
