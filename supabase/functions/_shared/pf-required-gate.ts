// PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B5): pure-function for pf required-gate.
// Извлечено из canonical-document-generate-strict для unit-теста.
// Контракт: возвращает один из исходов
//   - { kind: 'ok' }
//   - { kind: 'tokens_not_preresolved', tokens: string[] } → HTTP 400 в обвязке
//   - { kind: 'required_missing', fields: {public_id,label}[] } → HTTP 422
//
// Никакого I/O. Никаких побочных эффектов.

export interface PfParsedToken {
  public_id: string;
  raw_inside: string; // содержимое внутри {{...}} без скобок
}

export interface PfPreresolvedEntry {
  public_id: string;
  label: string;
  data_type: string;
  raw_value: unknown;
  rendered_value: string;
  effective_required: boolean;
  default_kind_applied?: string | null;
}

export type PfGateResult =
  | { kind: 'ok' }
  | { kind: 'tokens_not_preresolved'; tokens: string[] }
  | { kind: 'required_missing'; fields: Array<{ public_id: string; label: string }> };

export function evaluatePfRequiredGate(
  parsedPfTokens: PfParsedToken[],
  pfBag: Record<string, PfPreresolvedEntry>,
): PfGateResult {
  const missingPfPreresolved: string[] = [];
  const requiredMissing: Array<{ public_id: string; label: string }> = [];
  const seen = new Set<string>();
  for (const pt of parsedPfTokens) {
    if (!Object.prototype.hasOwnProperty.call(pfBag, pt.public_id)) {
      missingPfPreresolved.push(`{{${pt.raw_inside}}}`);
      continue;
    }
    if (seen.has(pt.public_id)) continue;
    seen.add(pt.public_id);
    const entry = pfBag[pt.public_id];
    const raw = entry.raw_value;
    const isEmpty = raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (entry.effective_required && isEmpty) {
      requiredMissing.push({ public_id: entry.public_id, label: entry.label });
    }
  }
  if (missingPfPreresolved.length > 0) {
    return { kind: 'tokens_not_preresolved', tokens: Array.from(new Set(missingPfPreresolved)) };
  }
  if (requiredMissing.length > 0) {
    return { kind: 'required_missing', fields: requiredMissing };
  }
  return { kind: 'ok' };
}
