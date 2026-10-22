export const AI_CHAT_AUDIT_VERSION = 'ai-chat-audit-20261022-v1';

// These are diagnostic codes and counters, never request/model/file contents.
type AuditDetails = {
  'ai_chat.upload_not_allowed_for_mode': { mode: string; scenario_code: string | null; prompt_id: string | null };
  'ai_chat.access_denied': { mode: string; scenario_code: string | null; reason?: string; access_tier: string };
  'ai_chat.quota_denied': { mode: string; scenario_code: string | null; limit_key: string; used: { daily: number; monthly: number }; limits: { daily: number; monthly: number } };
  'ai_chat.rate_limit_per_minute': { mode: string; count_last_60s: number; limit: number };
  'ai_chat.quota_denied_chars': { mode: string; used_chars: number; limit_chars: number };
  'ai_chat.mns_law_rejected': { prompt_id: string; baseline: string; corpus_sha256?: string; current_output: boolean; follows_current_law: boolean };
  'ai_chat.mns_citation_rejected': { prompt_id: string; corpus_sha256?: string; rejected_count: number };
};
type AuditAction = keyof AuditDetails;

function failureKind(error: unknown): string {
  // PostgREST messages/details may contain row values. Do not log them.
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  switch (code) {
    case '42703': case '42P01': case 'PGRST204': case 'PGRST205': return 'schema';
    case '23502': case '23503': case '23514': return 'constraint';
    case '42501': return 'permission';
    default: return 'write_error';
  }
}

export async function writeAccessAudit<A extends AuditAction>(
  client: any, userId: string, action: A, details: AuditDetails[A],
): Promise<boolean> {
  try {
    const { data, error } = await client.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: 'user',
      action,
      entity_type: 'ai_chat',
      meta: { ...details, audit_schema_version: AI_CHAT_AUDIT_VERSION },
    }).select('id').single();
    if (error || !data?.id) {
      console.warn('[gorbova-ai-chat] audit_write_failed', { action, kind: error ? failureKind(error) : 'missing_receipt' });
      return false;
    }
    return true;
  } catch {
    console.warn('[gorbova-ai-chat] audit_write_failed', { action, kind: 'exception' });
    return false;
  }
}
