// ============================================================================
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4a — unit tests
// Tests cover ln-custom-scalar-prepare.ts via fake supabase.
//
// Run:
//   deno test supabase/functions/canonical-document-generate-strict/__tests__/ln-custom-scalar-render.test.ts
// ============================================================================

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { prepareLnCustomScalarBag } from '../../_shared/ln-custom-scalar-prepare.ts';

const TPL = '00000000-0000-0000-0000-0000000000dd';
const ITEM = '00000000-0000-0000-0000-0000000000bb';
const SESSION = '00000000-0000-0000-0000-0000000000cc';

function makeFakeSupabase(rows: any) {
  return {
    from(table: string) {
      const data = rows[table] || [];
      const builder: any = {
        _rows: [...data],
        _filters: [] as Array<(r: any) => boolean>,
        select() { return builder; },
        eq(col: string, val: any) { builder._filters.push((r: any) => r[col] === val); return builder; },
        in(col: string, vals: any[]) { builder._filters.push((r: any) => vals.includes(r[col])); return builder; },
        order() { return builder; },
        async maybeSingle() {
          const f = builder._rows.filter((r: any) => builder._filters.every((fn: any) => fn(r)));
          return { data: f[0] ?? null };
        },
        then(resolve: any) {
          const f = builder._rows.filter((r: any) => builder._filters.every((fn: any) => fn(r)));
          resolve({ data: f, error: null });
        },
      };
      return builder;
    },
  } as any;
}

function role(id: string, lnKey: string, customFieldKeys: string[]) {
  return {
    id, role_key: lnKey, package_template_id: TPL,
    metadata: { assignment_custom_fields: customFieldKeys.map((k) => ({ key: k })) },
  };
}

function asg(roleId: string, custom: Record<string, string>, ix = 1) {
  return {
    role_catalog_id: roleId, package_session_id: SESSION, package_template_item_id: ITEM,
    is_active: true, sort_order: ix, created_at: `2026-01-0${ix}`, id: `a${ix}`,
    metadata: { custom },
  };
}

Deno.test('E.4a#18 1 active assignment + key есть + значение есть → подставлено', async () => {
  const supabase = makeFakeSupabase({
    document_package_role_catalog: [role('r1', 'ln-000015', ['votes'])],
    document_package_item_role_assignments: [asg('r1', { votes: '42' })],
  });
  const { bag } = await prepareLnCustomScalarBag({
    supabase, packageSessionId: SESSION, packageTemplateItemId: ITEM, packageTemplateId: TPL,
    tokens: [{ raw_inside: 'ln-000015.custom.votes', ln_public_id: 'ln-000015', custom_key: 'votes' }],
  });
  assertEquals(bag['ln-000015.custom.votes'].value, '42');
  assertEquals(bag['ln-000015.custom.votes'].code, 'ok');
});

Deno.test('E.4a#19 2+ active assignments → ambiguous', async () => {
  const supabase = makeFakeSupabase({
    document_package_role_catalog: [role('r1', 'ln-000015', ['votes'])],
    document_package_item_role_assignments: [asg('r1', { votes: '1' }, 1), asg('r1', { votes: '2' }, 2)],
  });
  const { bag } = await prepareLnCustomScalarBag({
    supabase, packageSessionId: SESSION, packageTemplateItemId: ITEM, packageTemplateId: TPL,
    tokens: [{ raw_inside: 'ln-000015.custom.votes', ln_public_id: 'ln-000015', custom_key: 'votes' }],
  });
  assertEquals(bag['ln-000015.custom.votes'].value, '');
  assertEquals(bag['ln-000015.custom.votes'].code, 'ln_custom_multi_assignment_ambiguous');
});

Deno.test('E.4a#20 key вне schema роли → role_no_custom_field_def', async () => {
  const supabase = makeFakeSupabase({
    document_package_role_catalog: [role('r1', 'ln-000015', ['votes'])],
    document_package_item_role_assignments: [asg('r1', { unknown: 'x' })],
  });
  const { bag } = await prepareLnCustomScalarBag({
    supabase, packageSessionId: SESSION, packageTemplateItemId: ITEM, packageTemplateId: TPL,
    tokens: [{ raw_inside: 'ln-000015.custom.unknown', ln_public_id: 'ln-000015', custom_key: 'unknown' }],
  });
  assertEquals(bag['ln-000015.custom.unknown'].value, '');
  assertEquals(bag['ln-000015.custom.unknown'].code, 'role_no_custom_field_def');
});

Deno.test('E.4a#21 пустое значение → ln_custom_value_empty', async () => {
  const supabase = makeFakeSupabase({
    document_package_role_catalog: [role('r1', 'ln-000015', ['votes'])],
    document_package_item_role_assignments: [asg('r1', { votes: '' })],
  });
  const { bag } = await prepareLnCustomScalarBag({
    supabase, packageSessionId: SESSION, packageTemplateItemId: ITEM, packageTemplateId: TPL,
    tokens: [{ raw_inside: 'ln-000015.custom.votes', ln_public_id: 'ln-000015', custom_key: 'votes' }],
  });
  assertEquals(bag['ln-000015.custom.votes'].value, '');
  assertEquals(bag['ln-000015.custom.votes'].code, 'ln_custom_value_empty');
});
