// ============================================================================
// document-resolver-v2 / catalog.ts
// PATCH E.2. Loads fields_registry catalog (active + non-deprecated) and
// classifies label collisions per E2.x.A.
//
// Filters (per E2.x.G):
//   - archived_at IS NULL
//   - options->>'deprecated_at' IS NULL
//   (fields_registry has NO is_active column — discovery noted in proof.)
// ============================================================================

// deno-lint-ignore-file no-explicit-any

export interface CatalogEntry {
  field_id: string;
  public_id: string;        // FLD-XXXXXX
  key: string;
  label: string;
  data_type: string;
  entity_type: string;
  scope: string | null;     // options.scope: system_customer | platform_executor | user_requisites | null
  subject_type: string | null; // options.subject_type: legal | individual | null
  options: Record<string, any>;
}

export interface CollisionWarning {
  type: 'label_collision_cross_scope';
  label: string;
  candidates: Array<{ field_public_id: string; scope: string | null; subject_type: string | null; entity_type: string }>;
}

export interface CollisionConflict {
  type: 'label_collision_within_scope';
  label: string;
  scope: string | null;
  subject_type: string | null;
  candidates: Array<{ field_public_id: string }>;
}

export interface Catalog {
  entries: CatalogEntry[];
  byPublicId: Map<string, CatalogEntry>;
  warnings: CollisionWarning[];
  conflicts: CollisionConflict[];
  /** label-only conflict members (writes blocked) */
  conflictPublicIds: Set<string>;
  totals: {
    active_total: number;
    deprecated_excluded: number;
    archived_excluded: number;
    by_scope: Record<string, number>;
  };
}

export async function loadCatalog(supabase: any): Promise<Catalog> {
  // 1) Active + non-deprecated.
  const { data: rows, error } = await supabase
    .from('fields_registry')
    .select('id, public_id, key, label, data_type, entity_type, options, archived_at')
    .is('archived_at', null);
  if (error) throw new Error(`catalog_load_failed:${error.message}`);

  const entries: CatalogEntry[] = [];
  let deprecated_excluded = 0;
  for (const r of rows || []) {
    const opts = (r.options || {}) as Record<string, any>;
    if (opts.deprecated_at) { deprecated_excluded += 1; continue; }
    if (!r.public_id) continue; // public_id is required for resolver
    entries.push({
      field_id: r.id,
      public_id: r.public_id,
      key: r.key,
      label: r.label,
      data_type: r.data_type || 'text',
      entity_type: r.entity_type,
      scope: (opts.scope as string) || null,
      subject_type: (opts.subject_type as string) || null,
      options: opts,
    });
  }

  // 2) Counts for archived (separately).
  const { count: archivedCount } = await supabase
    .from('fields_registry')
    .select('id', { count: 'exact', head: true })
    .not('archived_at', 'is', null);

  // 3) Group label collisions.
  // Within (scope, subject_type, label): conflict.
  // Across scope (any) but same label: warning.
  const byLabel = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    const arr = byLabel.get(e.label) || [];
    arr.push(e);
    byLabel.set(e.label, arr);
  }

  const warnings: CollisionWarning[] = [];
  const conflicts: CollisionConflict[] = [];
  const conflictPublicIds = new Set<string>();

  for (const [label, group] of byLabel.entries()) {
    if (group.length < 2) continue;
    // group by (scope|null, subject_type|null)
    const sub = new Map<string, CatalogEntry[]>();
    for (const e of group) {
      const k = `${e.scope ?? '-'}::${e.subject_type ?? '-'}`;
      const arr = sub.get(k) || [];
      arr.push(e);
      sub.set(k, arr);
    }
    let withinScopeFound = false;
    for (const [k, arr] of sub.entries()) {
      if (arr.length < 2) continue;
      withinScopeFound = true;
      const [scope, subject_type] = k.split('::');
      conflicts.push({
        type: 'label_collision_within_scope',
        label,
        scope: scope === '-' ? null : scope,
        subject_type: subject_type === '-' ? null : subject_type,
        candidates: arr.map(e => ({ field_public_id: e.public_id })),
      });
      for (const e of arr) conflictPublicIds.add(e.public_id);
    }
    // If overall group spans more than one (scope, subject_type) bucket → cross-scope warning.
    if (sub.size > 1 && !withinScopeFound) {
      warnings.push({
        type: 'label_collision_cross_scope',
        label,
        candidates: group.map(e => ({
          field_public_id: e.public_id,
          scope: e.scope,
          subject_type: e.subject_type,
          entity_type: e.entity_type,
        })),
      });
    } else if (sub.size > 1 && withinScopeFound) {
      // Mixed: report cross-scope warning AND within-scope conflict.
      warnings.push({
        type: 'label_collision_cross_scope',
        label,
        candidates: group.map(e => ({
          field_public_id: e.public_id,
          scope: e.scope,
          subject_type: e.subject_type,
          entity_type: e.entity_type,
        })),
      });
    }
  }

  const byPublicId = new Map<string, CatalogEntry>(entries.map(e => [e.public_id, e]));

  const by_scope: Record<string, number> = {};
  for (const e of entries) {
    const k = e.scope || `entity:${e.entity_type}`;
    by_scope[k] = (by_scope[k] || 0) + 1;
  }

  return {
    entries,
    byPublicId,
    warnings,
    conflicts,
    conflictPublicIds,
    totals: {
      active_total: entries.length,
      deprecated_excluded,
      archived_excluded: archivedCount || 0,
      by_scope,
    },
  };
}
