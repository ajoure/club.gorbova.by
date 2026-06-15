// PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B5): pure dedup + effective-override utility.
// Извлечено из usePackageSessionFields для покрытия vitest без рендера React.

export interface DedupField {
  id: string;
  label: string;
  required: boolean;
  description?: string | null;
  sort_order: number;
}

export interface DedupAssignment {
  id: string;
  package_template_item_id: string;
  field_catalog_id: string;
  visibility_mode: string;
  sort_order: number;
  created_at: string;
  is_required_override: boolean | null;
  label_override: string | null;
  help_override: string | null;
}

export interface DedupQuestion<F extends DedupField, A extends DedupAssignment> {
  field: F;
  canonicalAssignment: A;
  occurrences: number;
  itemIds: string[];
  effective: { label: string; required: boolean; help: string | null };
}

export function dedupePackageQuestions<F extends DedupField, A extends DedupAssignment>(
  fields: F[],
  assignments: A[],
): DedupQuestion<F, A>[] {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const byField = new Map<string, A[]>();
  for (const r of assignments) {
    if (r.visibility_mode !== "ask_client") continue;
    if (!fieldById.has(r.field_catalog_id)) continue;
    const arr = byField.get(r.field_catalog_id) ?? [];
    arr.push(r);
    byField.set(r.field_catalog_id, arr);
  }

  const out: DedupQuestion<F, A>[] = [];
  for (const [fieldId, arr] of byField) {
    const field = fieldById.get(fieldId)!;
    const sorted = [...arr].sort((a, b) => {
      const aOv = a.is_required_override !== null || !!a.label_override || !!a.help_override;
      const bOv = b.is_required_override !== null || !!b.label_override || !!b.help_override;
      if (aOv !== bOv) return aOv ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.created_at.localeCompare(b.created_at);
    });
    const canonical = sorted[0];
    const required = canonical.is_required_override !== null
      ? !!canonical.is_required_override
      : !!field.required;
    out.push({
      field,
      canonicalAssignment: canonical,
      occurrences: arr.length,
      itemIds: arr.map((a) => a.package_template_item_id),
      effective: {
        label: canonical.label_override?.trim() || field.label,
        required,
        help: canonical.help_override?.trim() || field.description || null,
      },
    });
  }

  out.sort((a, b) => {
    if (a.effective.required !== b.effective.required) return a.effective.required ? -1 : 1;
    if (a.field.sort_order !== b.field.sort_order) return a.field.sort_order - b.field.sort_order;
    return a.effective.label.localeCompare(b.effective.label);
  });
  return out;
}
