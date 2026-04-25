// PATCH-GUARD: Защита ручных рассылок от катастрофического full-scan / коротких сообщений.
// Применяется ТОЛЬКО к user-path. System-actor (scheduled dispatcher) проходит без проверок.
//
// Правила:
//   1. Audience-restriction обязателен:
//      - новая схема: include[]/exclude[]/club_ids[] (хотя бы один непустой массив)
//      - ИЛИ legacy: hasActiveSubscription / productId / productIds / tariffId / tariffIds / clubId
//      - ИЛИ explicit override: allow_full_audience=true + confirm_full_audience_text="SEND TO ALL"
//   2. Минимальная длина сообщения (>=5) для real send. Игнорируется для dry_run / test_self.
//   3. Любой блок логируется в audit_logs.

export const FULL_AUDIENCE_CONFIRM_TEXT = 'SEND TO ALL';

export interface BroadcastGuardInput {
  filters: any;
  messageText: string;          // text/html/subject — для проверки минимальной длины
  isDryRun: boolean;
  isTestSelf: boolean;
  allowFullAudience: boolean;
  confirmFullAudienceText: string | null;
}

export interface BroadcastGuardBlock {
  blocked: true;
  reason:
    | 'broadcast_blocked_empty_audience_filters'
    | 'broadcast_blocked_full_audience_without_confirm'
    | 'broadcast_blocked_short_message';
  message: string;
  meta: Record<string, unknown>;
}

export interface BroadcastGuardOk {
  blocked: false;
}

export type BroadcastGuardResult = BroadcastGuardBlock | BroadcastGuardOk;

function hasAudienceRestriction(filters: any): boolean {
  if (!filters || typeof filters !== 'object') return false;

  // New schema
  if (Array.isArray(filters.include) && filters.include.length > 0) return true;
  if (Array.isArray(filters.exclude) && filters.exclude.length > 0) return true;
  if (Array.isArray(filters.club_ids) && filters.club_ids.length > 0) return true;

  // Legacy schema
  if (filters.hasActiveSubscription === true) return true;
  if (typeof filters.productId === 'string' && filters.productId.trim()) return true;
  if (Array.isArray(filters.productIds) && filters.productIds.length > 0) return true;
  if (typeof filters.tariffId === 'string' && filters.tariffId.trim()) return true;
  if (Array.isArray(filters.tariffIds) && filters.tariffIds.length > 0) return true;
  if (typeof filters.clubId === 'string' && filters.clubId.trim()) return true;

  // Bot-only segmentation тоже валидное ограничение для telegram
  if (Array.isArray(filters.bot_ids) && filters.bot_ids.length > 0) return true;

  return false;
}

export function evaluateBroadcastGuards(input: BroadcastGuardInput): BroadcastGuardResult {
  const {
    filters,
    messageText,
    isDryRun,
    isTestSelf,
    allowFullAudience,
    confirmFullAudienceText,
  } = input;

  const restricted = hasAudienceRestriction(filters);
  const wouldBeFullAudience = !restricted;

  // Rule 1: empty/missing filters — нет audience restriction
  if (wouldBeFullAudience) {
    if (!allowFullAudience) {
      return {
        blocked: true,
        reason: 'broadcast_blocked_empty_audience_filters',
        message:
          'Empty audience filters: real send to entire base is blocked. ' +
          'Pass allow_full_audience=true with confirm_full_audience_text="SEND TO ALL" to override.',
        meta: {
          would_be_full_audience: true,
          filters,
        },
      };
    }
    if (confirmFullAudienceText !== FULL_AUDIENCE_CONFIRM_TEXT) {
      return {
        blocked: true,
        reason: 'broadcast_blocked_full_audience_without_confirm',
        message:
          'Full-audience override requested but confirm_full_audience_text is missing or wrong. ' +
          `Expected exact value: "${FULL_AUDIENCE_CONFIRM_TEXT}".`,
        meta: {
          would_be_full_audience: true,
          allow_full_audience: true,
          confirm_provided: !!confirmFullAudienceText,
          filters,
        },
      };
    }
  }

  // Rule 2: короткое сообщение — допустимо только в dry_run / test_self
  const trimmedLen = (messageText || '').trim().length;
  if (!isDryRun && !isTestSelf && trimmedLen < 5) {
    return {
      blocked: true,
      reason: 'broadcast_blocked_short_message',
      message:
        `Message too short for real broadcast (length=${trimmedLen}, min=5). ` +
        'Use dry_run=true for testing.',
      meta: {
        message_length: trimmedLen,
        would_be_full_audience: wouldBeFullAudience,
      },
    };
  }

  return { blocked: false };
}

export interface AuditBlockedAttemptInput {
  supabase: any;
  channel: 'telegram' | 'email';
  actorUserId: string | null;
  isSystemActor: boolean;
  reason: BroadcastGuardBlock['reason'];
  filters: any;
  messageText: string;
  extraMeta?: Record<string, unknown>;
}

export async function auditBlockedAttempt(input: AuditBlockedAttemptInput): Promise<void> {
  const {
    supabase,
    channel,
    actorUserId,
    isSystemActor,
    reason,
    filters,
    messageText,
    extraMeta = {},
  } = input;

  const preview = (messageText || '').trim().substring(0, 80);

  try {
    await supabase.from('audit_logs').insert({
      actor_user_id: isSystemActor ? null : actorUserId,
      action: reason,
      meta: {
        channel,
        actor_type: isSystemActor ? 'system' : 'user',
        actor_label: isSystemActor ? 'broadcast-dispatcher' : undefined,
        reason,
        message_preview: preview,
        message_length: (messageText || '').trim().length,
        filters,
        would_be_full_audience: !hasAudienceRestrictionPublic(filters),
        ...extraMeta,
      },
    });
  } catch (err) {
    console.error('[broadcast-guards] failed to write blocked-attempt audit:', err);
  }
}

// Re-export для удобной диагностики снаружи
export function hasAudienceRestrictionPublic(filters: any): boolean {
  return hasAudienceRestriction(filters);
}
