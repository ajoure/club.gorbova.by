// ============================================================================
// document-resolver-v2 / resolver.ts
// PATCH E.2. Pure resolver — strict ID-first. Label is NEVER used to choose a
// field; lookup is by FLD public_id only.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import type { Catalog, CatalogEntry } from './catalog.ts';
import { SOURCE_PRIORITY, type ResolverSource } from './sources.ts';

export type ResolveStatus =
  | 'resolved'
  | 'missing'
  | 'conflict'
  | 'locked'
  | 'locked_manual_override'
  | 'source_unmapped';

export interface SourceTraceEntry {
  field_public_id: string;
  label: string;
  scope: string | null;
  subject_type: string | null;
  entity_type: string;
  source: ResolverSource;
  source_priority: number;
  status: ResolveStatus;
  reason: string | null;
}

export interface ResolvedField {
  value: any;
  scope: string | null;
  subject_type: string | null;
  entity_type: string;
  source: ResolverSource;
  source_priority: number;
  scope_lock: true;
  resolver_version: string;
  manual_override: false;
  locked_at: string;
}

export interface OrderInput {
  id: string;
  user_id: string | null;
  order_number: string | null;
  final_price: number | null;
  base_price: number | null;
  currency: string | null;
  paid_at: string | null;
  created_at: string | null;
  meta: Record<string, any>;
}

export interface RequisitesInput {
  legal: { id: string; data: Record<string, any> } | null;
  individual: { id: string; data: Record<string, any> } | null;
}

export interface ExecutorInput {
  id: string;
  // arbitrary columns
  [k: string]: any;
}

export interface ResolverContext {
  order: OrderInput;
  requisites: RequisitesInput;
  executor: ExecutorInput | null;
  /** Existing snapshot in orders_v2.meta.document_data.fields */
  existingSnapshot: Record<string, any>;
  resolverVersion: string;
}

export interface ResolverResult {
  resolved: Record<string, ResolvedField>;
  source_trace: SourceTraceEntry[];
  /** FLDs blocked by within-scope label collision (catalog-level). */
  conflicts_blocked: string[];
  /** FLDs already locked by scope_lock (skipped). */
  locked: string[];
  /** FLDs already locked by manual_override (skipped). */
  locked_manual_override: string[];
  /** FLDs that have no wired source in v2 yet. */
  source_unmapped: string[];
  /** FLDs catalog had, but no value resolved. */
  missing: string[];
}

interface ResolveOptions {
  /** If true, ignore scope_lock (rebuild). */
  rebuild: boolean;
  /** If true, also override manual_override fields. */
  includeManualOverrides: boolean;
  /** Subset of FLD public_ids to resolve. If null → entire catalog. */
  scopePublicIds: Set<string> | null;
}

export function resolveFields(
  catalog: Catalog,
  ctx: ResolverContext,
  opts: ResolveOptions,
): ResolverResult {
  const out: ResolverResult = {
    resolved: {},
    source_trace: [],
    conflicts_blocked: [],
    locked: [],
    locked_manual_override: [],
    source_unmapped: [],
    missing: [],
  };

  const targets: CatalogEntry[] = opts.scopePublicIds
    ? catalog.entries.filter(e => opts.scopePublicIds!.has(e.public_id))
    : catalog.entries;

  for (const entry of targets) {
    const fid = entry.public_id;

    // 1) Conflict (within-scope label collision) — never write.
    if (catalog.conflictPublicIds.has(fid)) {
      out.conflicts_blocked.push(fid);
      out.source_trace.push({
        field_public_id: fid,
        label: entry.label,
        scope: entry.scope,
        subject_type: entry.subject_type,
        entity_type: entry.entity_type,
        source: 'unmapped',
        source_priority: 0,
        status: 'conflict',
        reason: 'label_collision_within_scope',
      });
      continue;
    }

    // 2) Existing snapshot lock checks.
    const existing = ctx.existingSnapshot[fid];
    if (existing && typeof existing === 'object') {
      if (existing.manual_override === true && !opts.includeManualOverrides) {
        out.locked_manual_override.push(fid);
        out.source_trace.push({
          field_public_id: fid,
          label: entry.label,
          scope: entry.scope,
          subject_type: entry.subject_type,
          entity_type: entry.entity_type,
          source: existing.source || 'manual_override',
          source_priority: SOURCE_PRIORITY.manual_override,
          status: 'locked_manual_override',
          reason: 'manual_override=true; pass include_manual_overrides=true to override',
        });
        continue;
      }
      if (existing.scope_lock === true && !opts.rebuild) {
        out.locked.push(fid);
        out.source_trace.push({
          field_public_id: fid,
          label: entry.label,
          scope: entry.scope,
          subject_type: entry.subject_type,
          entity_type: entry.entity_type,
          source: existing.source || 'unmapped',
          source_priority: existing.source_priority || 0,
          status: 'locked',
          reason: 'scope_lock=true; use mode=rebuild to refresh',
        });
        continue;
      }
    }

    // 3) Resolve from sources.
    const r = resolveOne(entry, ctx);
    if (r === null) {
      out.source_unmapped.push(fid);
      out.source_trace.push({
        field_public_id: fid,
        label: entry.label,
        scope: entry.scope,
        subject_type: entry.subject_type,
        entity_type: entry.entity_type,
        source: 'unmapped',
        source_priority: 0,
        status: 'source_unmapped',
        reason: `no source wired for entity_type=${entry.entity_type} scope=${entry.scope ?? '-'}`,
      });
      continue;
    }

    if (r.value === undefined || r.value === null || r.value === '') {
      out.missing.push(fid);
      out.source_trace.push({
        field_public_id: fid,
        label: entry.label,
        scope: entry.scope,
        subject_type: entry.subject_type,
        entity_type: entry.entity_type,
        source: r.source,
        source_priority: SOURCE_PRIORITY[r.source],
        status: 'missing',
        reason: 'no_value_in_source',
      });
      continue;
    }

    out.resolved[fid] = {
      value: r.value,
      scope: entry.scope,
      subject_type: entry.subject_type,
      entity_type: entry.entity_type,
      source: r.source,
      source_priority: SOURCE_PRIORITY[r.source],
      scope_lock: true,
      resolver_version: ctx.resolverVersion,
      manual_override: false,
      locked_at: new Date().toISOString(),
    };
    out.source_trace.push({
      field_public_id: fid,
      label: entry.label,
      scope: entry.scope,
      subject_type: entry.subject_type,
      entity_type: entry.entity_type,
      source: r.source,
      source_priority: SOURCE_PRIORITY[r.source],
      status: 'resolved',
      reason: null,
    });
  }

  return out;
}

function resolveOne(
  entry: CatalogEntry,
  ctx: ResolverContext,
): { value: any; source: ResolverSource } | null {
  const { key, entity_type, scope } = entry;

  // user_requisites.legal.*
  if (scope === 'user_requisites' && entry.subject_type === 'legal') {
    if (!ctx.requisites.legal) return null;
    const sub = key.replace(/^user_requisites\.legal\./, '');
    return { value: ctx.requisites.legal.data?.[sub] ?? null, source: 'legal_entities_requisites' };
  }

  // user_requisites.individual.*
  if (scope === 'user_requisites' && entry.subject_type === 'individual') {
    if (!ctx.requisites.individual) return null;
    const sub = key.replace(/^user_requisites\.individual\./, '');
    const d = ctx.requisites.individual.data || {};
    // computed: passport_number_full = series + " " + number
    if (sub === 'passport_number_full') {
      const series = (d.passport_series ?? '').toString().trim();
      const num = (d.passport_number ?? '').toString().trim();
      const composed = [series, num].filter(Boolean).join(' ').trim();
      return { value: composed || null, source: 'computed' };
    }
    return { value: d[sub] ?? null, source: 'individual_requisites' };
  }

  // executor.*
  if (scope === 'platform_executor' || entity_type === 'executor') {
    if (!ctx.executor) return null;
    const sub = key.replace(/^executor\./, '');
    return { value: ctx.executor[sub] ?? null, source: 'executor' };
  }

  // system_customer (entity_type='customer' / 'customer_signer') — not wired in E.2.
  if (scope === 'system_customer') {
    return null; // → source_unmapped
  }

  // deal.* / order.*
  if (entity_type === 'deal') {
    return { value: resolveDeal(key, ctx.order), source: 'order_meta' };
  }

  // document.* — read from existing order.meta.document_data (legacy snapshot).
  if (entity_type === 'document') {
    const docFields = (ctx.order.meta?.document_data?.fields || {}) as Record<string, any>;
    const existing = docFields[entry.public_id];
    if (existing && typeof existing === 'object' && 'value' in existing) {
      return { value: existing.value, source: 'document_meta' };
    }
    return null;
  }

  return null; // unmapped
}

function resolveDeal(key: string, order: OrderInput): any {
  switch (key) {
    case 'deal.id': return order.id;
    case 'deal.amount':
    case 'order.amount': return order.final_price;
    case 'deal.currency':
    case 'order.currency': return order.currency;
    case 'deal.paid_at': return order.paid_at;
    case 'deal.product_name': return order.meta?.product_name ?? null;
    case 'deal.tariff_name': return order.meta?.tariff_name ?? null;
    case 'deal.access_days': return order.meta?.access_days ?? null;
    case 'order.created_at': return order.created_at;
    case 'order.customer_email': return order.meta?.customer_email ?? null;
    default: return null;
  }
}
