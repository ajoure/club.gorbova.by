// ============================================================================
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4a
// ln-custom-scalar-prepare.ts — real DOCX support для
// {{ln-XXXXXX.custom.<key>}} в обычных абзацах.
// ----------------------------------------------------------------------------
// Контракт:
//   • Используется только в package_session mode.
//   • Schema check: ключ должен быть в role.metadata.assignment_custom_fields[].
//   • Multi-policy: 2+ active assignments → '' + 'ln_custom_multi_assignment_ambiguous'.
//   • Empty value → '' + 'ln_custom_value_empty'.
//   • Modifier → блокируется ВЫШЕ парсером ('ln_custom_modifier_not_allowed').
//   • Не пишет в БД, не возвращает значения в audit.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export interface LnCustomTokenRequest {
  raw_inside: string;     // 'ln-000015.custom.votes' (без {{}})
  ln_public_id: string;   // 'ln-000015'
  custom_key: string;     // 'votes'
}

export interface LnCustomResolveEntry {
  value: string;
  code: 'ok' | 'ok_empty' | 'ln_custom_value_empty' | 'ln_custom_multi_assignment_ambiguous'
    | 'role_no_custom_field_def' | 'ln_role_not_found' | 'ln_role_no_assignments';
}

export interface LnCustomPrepareInput {
  supabase: SupabaseClient;
  packageSessionId: string;
  packageTemplateItemId: string;
  packageTemplateId: string;
  tokens: LnCustomTokenRequest[];
}

export interface LnCustomPrepareReport {
  tokens_count: number;
  codes_summary: Record<string, number>;
}

export interface LnCustomPrepareResult {
  bag: Record<string, LnCustomResolveEntry>;
  report: LnCustomPrepareReport;
}

export async function prepareLnCustomScalarBag(
  input: LnCustomPrepareInput,
): Promise<LnCustomPrepareResult> {
  const bag: Record<string, LnCustomResolveEntry> = {};
  const codes: Record<string, number> = {};
  const bump = (code: string) => { codes[code] = (codes[code] ?? 0) + 1; };

  if (!input.tokens.length) {
    return { bag, report: { tokens_count: 0, codes_summary: {} } };
  }

  // Дедуплицируем по уникальным ln_public_id (для batch lookup ролей).
  const lnPublicIds = Array.from(new Set(input.tokens.map((t) => t.ln_public_id)));

  // Roles by ln_public_id (role_key=ln-XXXXXX в нашем каноне).
  const { data: roleRows } = await input.supabase
    .from('document_package_role_catalog')
    .select('id, role_key, package_template_id, metadata')
    .eq('package_template_id', input.packageTemplateId)
    .in('role_key', lnPublicIds);

  const roleByLnId = new Map<string, { id: string; metadata: unknown }>();
  for (const r of (roleRows ?? []) as Array<{ id: string; role_key: string; metadata: unknown }>) {
    roleByLnId.set(r.role_key, { id: r.id, metadata: r.metadata });
  }

  // Загрузим assignments батчем (по всем role.id, что нашли).
  const roleIds = Array.from(roleByLnId.values()).map((r) => r.id);
  const assignmentsByRole = new Map<string, Array<{ metadata: unknown }>>();
  if (roleIds.length > 0) {
    const { data: asgs } = await input.supabase
      .from('document_package_item_role_assignments')
      .select('role_catalog_id, metadata, sort_order, created_at, id')
      .eq('package_session_id', input.packageSessionId)
      .eq('package_template_item_id', input.packageTemplateItemId)
      .in('role_catalog_id', roleIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    for (const a of (asgs ?? []) as Array<{ role_catalog_id: string; metadata: unknown }>) {
      const arr = assignmentsByRole.get(a.role_catalog_id) ?? [];
      arr.push({ metadata: a.metadata });
      assignmentsByRole.set(a.role_catalog_id, arr);
    }
  }

  for (const tok of input.tokens) {
    const role = roleByLnId.get(tok.ln_public_id);
    if (!role) {
      bag[tok.raw_inside] = { value: '', code: 'ln_role_not_found' };
      bump('ln_role_not_found');
      continue;
    }
    const roleMeta = (role.metadata && typeof role.metadata === 'object')
      ? role.metadata as Record<string, unknown>
      : {};
    const acf = Array.isArray(roleMeta['assignment_custom_fields'])
      ? roleMeta['assignment_custom_fields'] as Array<Record<string, unknown>>
      : [];
    const known = new Set<string>();
    for (const f of acf) {
      if (typeof f?.key === 'string') known.add(f.key);
    }
    if (!known.has(tok.custom_key)) {
      bag[tok.raw_inside] = { value: '', code: 'role_no_custom_field_def' };
      bump(`role_no_custom_field_def:${tok.custom_key}`);
      continue;
    }
    const assignments = assignmentsByRole.get(role.id) ?? [];
    if (assignments.length === 0) {
      bag[tok.raw_inside] = { value: '', code: 'ln_role_no_assignments' };
      bump('ln_role_no_assignments');
      continue;
    }
    if (assignments.length > 1) {
      bag[tok.raw_inside] = { value: '', code: 'ln_custom_multi_assignment_ambiguous' };
      bump('ln_custom_multi_assignment_ambiguous');
      continue;
    }
    const meta = (assignments[0].metadata && typeof assignments[0].metadata === 'object')
      ? assignments[0].metadata as Record<string, unknown>
      : {};
    const custom = (meta['custom'] && typeof meta['custom'] === 'object')
      ? meta['custom'] as Record<string, unknown>
      : {};
    const raw = custom[tok.custom_key];
    if (raw == null || raw === '') {
      bag[tok.raw_inside] = { value: '', code: 'ln_custom_value_empty' };
      bump('ln_custom_value_empty');
      continue;
    }
    bag[tok.raw_inside] = { value: String(raw), code: 'ok' };
    bump('ok');
  }

  return { bag, report: { tokens_count: input.tokens.length, codes_summary: codes } };
}
