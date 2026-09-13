import { safeDocumentErrorCode } from './document-generation-outcome.ts';

export function isSubmissionRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
export async function submissionFingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Replays are read-only: never start another generation or delivery. */
export function submissionReplay(row: Record<string, any>): { body: Record<string, unknown>; status: number } {
  const documentIds = Array.isArray(row.generated_document_ids) ? row.generated_document_ids : [];
  if (['generated', 'delivery_partial'].includes(row.status) && documentIds.length) {
    return { status: 200, body: {
      found: true, success: true, replayed: true, submission_id: row.id, document_ids: documentIds,
      generation_status: row.metadata?.generation_status === 'partial' ? 'partial' : 'generated',
      delivery_complete: row.metadata?.delivery_complete === true,
    } };
  }
  return { status: 200, body: {
    found: true, success: false, replayed: true, submission_id: row.id,
    error: row.status === 'failed' ? (safeDocumentErrorCode(row.error_code) ?? 'generation_outcome_unknown') : 'generation_in_progress',
  } };
}
