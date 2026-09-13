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

/** Old open pages have no request_id. Derive a stable, link-scoped attempt.
 * Upload paths are excluded from its identity because old pages re-upload on retry;
 * the full fingerprint still detects changed attachments instead of silently replaying them.
 */
export async function legacySubmissionRequestId(fields: unknown, repeatGroups: unknown, attachments: any[]): Promise<string> {
  const hash = await submissionFingerprint({ fields, repeat_groups: repeatGroups,
    attachments: attachments.map(a => ({ file_name: a.file_name, mime_type: a.mime_type, byte_size: a.byte_size })) });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Replays are read-only: never start another generation or delivery. */
export function submissionReplay(row: Record<string, any>): { body: Record<string, unknown>; status: number } {
  const documentIds = Array.isArray(row.generated_document_ids) ? row.generated_document_ids : [];
  if (['generated', 'delivery_partial'].includes(row.status) && documentIds.length) {
    return { status: 200, body: {
      found: true, success: true, replayed: true, submission_id: row.id, document_ids: documentIds,
      generation_status: row.metadata?.generation_status === 'partial' ? 'partial' : 'generated',
      delivery_complete: row.metadata?.delivery_complete === true,
      delivery_skipped: row.metadata?.delivery_skipped === true,
    } };
  }
  return { status: 200, body: {
    found: true, success: false, replayed: true, submission_id: row.id,
    can_start_new_attempt: row.status === 'failed' && row.metadata?.stage === 'preparation' && row.metadata?.safe_to_retry === true,
    error: row.status === 'failed' ? (safeDocumentErrorCode(row.error_code) ?? 'generation_outcome_unknown') : 'generation_in_progress',
  } };
}
