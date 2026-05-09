// ============================================================================
// executor-fields.ts — Sprint 11 (Hide-Executor-Fields)
// ----------------------------------------------------------------------------
// Canonical mapping executor row → FLD-XXXXXX (entity_type='executor').
// Used by snapshot + rebuild_executor flows so users никогда не редактируют
// эти поля вручную.
// ============================================================================

// deno-lint-ignore-file no-explicit-any

export type ExecutorSource = 'executor_offer' | 'executor_default';

export interface ExecutorRow {
  id: string;
  full_name: string | null;
  short_name: string | null;
  unp: string | null;
  legal_address: string | null;
  bank_name: string | null;
  bank_code: string | null;
  bank_account: string | null;
  director_full_name: string | null;
  director_short_name: string | null;
  director_position: string | null;
  acts_on_basis: string | null;
  phone: string | null;
  email: string | null;
}

function fullNameToInitials(fullName?: string | null): string {
  if (!fullName) return '';
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

/** All FLD-IDs that belong to executor entity. */
export const EXECUTOR_FLD_IDS = [
  'FLD-000103','FLD-000104','FLD-000105','FLD-000106','FLD-000107',
  'FLD-000108','FLD-000109','FLD-000110','FLD-000111','FLD-000112',
  'FLD-000150','FLD-000151','FLD-000152','FLD-000153','FLD-000154',
] as const;

/** Map executor row → FLD-XXX value record. Empty/null values stay as ''. */
export function buildExecutorFieldValues(ex: ExecutorRow | null): Record<string, string> {
  if (!ex) {
    const empty: Record<string, string> = {};
    for (const fid of EXECUTOR_FLD_IDS) empty[fid] = '';
    return empty;
  }
  return {
    'FLD-000103': ex.full_name || '',
    'FLD-000104': ex.short_name || ex.full_name || '',
    'FLD-000105': ex.unp || '',
    'FLD-000106': ex.legal_address || '',
    'FLD-000107': ex.bank_name || '',
    'FLD-000108': ex.bank_code || '',
    'FLD-000109': ex.bank_account || '',
    'FLD-000110': ex.director_full_name || '',
    'FLD-000111': ex.director_short_name || fullNameToInitials(ex.director_full_name),
    'FLD-000112': ex.acts_on_basis || '',
    'FLD-000150': ex.phone || '',
    'FLD-000151': ex.email || '',
    'FLD-000152': ex.director_full_name || '',
    'FLD-000153': ex.director_position || '',
    'FLD-000154': ex.acts_on_basis || '',
  };
}

/**
 * Resolve executor: explicit id wins → fallback to default executor.
 * Returns row + which source applied.
 */
export async function resolveExecutorForOrder(
  supabase: any,
  explicitExecutorId: string | null | undefined,
): Promise<{ executor: ExecutorRow | null; source: ExecutorSource | null; executor_id: string | null }> {
  if (explicitExecutorId) {
    const { data } = await supabase
      .from('executors')
      .select('id, full_name, short_name, unp, legal_address, bank_name, bank_code, bank_account, director_full_name, director_short_name, director_position, acts_on_basis, phone, email')
      .eq('id', explicitExecutorId)
      .maybeSingle();
    if (data) return { executor: data as ExecutorRow, source: 'executor_offer', executor_id: data.id };
  }
  const { data: def } = await supabase
    .from('executors')
    .select('id, full_name, short_name, unp, legal_address, bank_name, bank_code, bank_account, director_full_name, director_short_name, director_position, acts_on_basis, phone, email')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (def) return { executor: def as ExecutorRow, source: 'executor_default', executor_id: def.id };
  return { executor: null, source: null, executor_id: null };
}

/**
 * Merge executor values into existing docFields.
 * NEVER overwrites entries with manual_override === true.
 * Returns updated map + per-FLD action ('written'|'skipped_manual'|'noop_same_value').
 */
export function mergeExecutorIntoFields(
  fields: Record<string, any>,
  executorValues: Record<string, string>,
  source: ExecutorSource,
  executorId: string,
  nowIso: string,
): { fields: Record<string, any>; trace: Record<string, 'written' | 'skipped_manual' | 'noop_same_value'> } {
  const out = { ...fields };
  const trace: Record<string, 'written' | 'skipped_manual' | 'noop_same_value'> = {};
  for (const fid of EXECUTOR_FLD_IDS) {
    const existing = out[fid];
    if (existing && existing.manual_override === true) {
      trace[fid] = 'skipped_manual';
      continue;
    }
    const newValue = executorValues[fid] ?? '';
    if (existing && String(existing.value ?? '') === newValue && existing.executor_id === executorId) {
      trace[fid] = 'noop_same_value';
      continue;
    }
    out[fid] = {
      value: newValue,
      source,
      executor_id: executorId,
      manual_override: false,
      updated_at: nowIso,
    };
    trace[fid] = 'written';
  }
  return { fields: out, trace };
}
