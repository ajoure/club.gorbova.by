/**
 * Phase 1: FulfillmentExecutor — centralized ledger writer for grant/extend paths.
 * PATCH v22.3: DDL-compatible strict unions, normalized PostCheckResult, runtime validation.
 * 
 * Contract:
 * - Every grant/extend MUST produce a ledger row in access_grant_ledger.
 * - source_event_key must be deterministic (no timestamps, no random).
 * - post_check is written after business action completes via merge (not replace).
 * - writeLedgerEntry returns { id, execution_key } for parent propagation.
 * - Runtime validation enforces all DDL CHECKs before insert.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ── Strict unions from DDL CHECKs ──

export type LedgerActionType = 'grant' | 'extend' | 'reactivate' | 'revoke' | 'expire' | 'skip' | 'failed' | 'batch_start';

export type LedgerStatus = 'granted' | 'extended' | 'revoked' | 'expired' | 'reactivated' | 'skipped' | 'failed' | 'completed';

export type LedgerTargetType = 'product' | 'club' | 'training_module' | 'feature' | 'batch' | 'domain' | 'menu_item' | 'training_lesson' | 'subscription_tier';

export type LedgerReasonCode =
  | 'paid_order'
  | 'trial_start'
  | 'subscription_renew'
  | 'subscription_extend'
  | 'admin_grant'
  | 'bulk_import'
  | 'rule_engine_bonus'
  | 'payment_failed'
  | 'trial_expired'
  | 'admin_cancel'
  | 'subscription_expired'
  | 'admin_revoke'
  | 'cron_cleanup'
  | 'violation_kick'
  | 'duplicate_skip'
  | 'already_active'
  | 'no_matching_target'
  | 'batch_orchestration';

export type LedgerSourceSubjectType = 'order' | 'subscription' | 'admin_action' | 'import_batch' | 'cron_job' | 'system' | 'rule_engine_trigger';

export type LedgerSourceEventType = 'webhook' | 'cron' | 'admin' | 'system';

// ── Action ↔ Status compatibility map (chk_action_status_compat) ──

const ACTION_STATUS_MAP: Record<LedgerActionType, LedgerStatus[]> = {
  grant: ['granted', 'failed', 'skipped'],
  extend: ['extended', 'failed', 'skipped'],
  reactivate: ['reactivated', 'failed', 'skipped'],
  revoke: ['revoked', 'failed', 'skipped'],
  expire: ['expired', 'failed', 'skipped'],
  skip: ['skipped'],
  failed: ['failed'],
  batch_start: ['completed', 'failed'],
};

// ── Dictionaries for runtime validation ──

const VALID_TARGET_TYPES: Set<string> = new Set<string>([
  'product', 'club', 'training_module', 'feature', 'batch',
  'domain', 'menu_item', 'training_lesson', 'subscription_tier',
]);

const VALID_REASON_CODES: Set<string> = new Set<string>([
  'paid_order', 'trial_start', 'subscription_renew', 'subscription_extend',
  'admin_grant', 'bulk_import', 'rule_engine_bonus', 'payment_failed',
  'trial_expired', 'admin_cancel', 'subscription_expired', 'admin_revoke',
  'cron_cleanup', 'violation_kick', 'duplicate_skip', 'already_active',
  'no_matching_target', 'batch_orchestration',
]);

const VALID_SOURCE_SUBJECT_TYPES: Set<string> = new Set<string>([
  'order', 'subscription', 'admin_action', 'import_batch',
  'cron_job', 'system', 'rule_engine_trigger',
]);

// ── LedgerEntry interface ──

export interface LedgerEntry {
  source_event_type: LedgerSourceEventType;
  source_event_key: string;
  source_subject_type: LedgerSourceSubjectType;
  source_subject_ref?: string | null;
  source_order_id?: string | null;
  source_subscription_id?: string | null;
  source_offer_id?: string | null;
  action_type: LedgerActionType;
  reason_code: LedgerReasonCode;
  target_type: LedgerTargetType;
  target_key: string;
  target_ref?: string | null;
  user_id?: string | null;
  profile_id?: string | null;
  order_id?: string | null;
  status: LedgerStatus;
  result?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  error_details?: Record<string, unknown> | null;
  parent_event_key?: string | null;
  parent_execution_key?: string | null;
}

// ── Normalized PostCheck schema (v22 contract) ──

export interface PostCheckItem {
  applicability: 'required' | 'not_applicable';
  status: 'pass' | 'warn' | 'fail' | null;
  details?: string;
  ref?: string;
}

export interface PostCheckResult {
  entitlement: PostCheckItem;
  telegram: PostCheckItem;
  subscription: PostCheckItem;
  ledger_row: PostCheckItem;
  target_resolution: PostCheckItem;
}

// ── target_key contract per target_type ──
// product       → {user_id}:{product_code || product_id}
// subscription_tier → {user_id}:{tariff_id || tariff_code}
// club          → {user_id}:{club_id}
// batch         → {batch_id}

// ── Runtime validation ──

/**
 * Validate source_event_key is deterministic.
 * STOP-guard: reject keys with timestamps, random values, Date.now().
 * Throws on invalid key.
 */
export function validateSourceEventKey(key: string): void {
  if (!key || key.length === 0) {
    throw new Error('[FulfillmentExecutor] source_event_key is empty');
  }
  if (!key.includes(':')) {
    throw new Error(`[FulfillmentExecutor] source_event_key must contain ":" separator: "${key}"`);
  }

  // Block ISO timestamp patterns (2024-01-01T00:00:00, etc.)
  const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  if (isoPattern.test(key)) {
    throw new Error(`[FulfillmentExecutor] source_event_key contains ISO timestamp (forbidden): "${key}"`);
  }

  // Block Date.now()-like numeric timestamps (13+ digit numbers)
  const timestampPattern = /\d{13,}/;
  if (timestampPattern.test(key)) {
    throw new Error(`[FulfillmentExecutor] source_event_key contains timestamp-like number (forbidden): "${key}"`);
  }

  // Block obvious non-deterministic patterns in the string value
  const forbiddenPatterns = ['Date.now()', 'Math.random()', 'new Date()', 'crypto.randomUUID()'];
  for (const pattern of forbiddenPatterns) {
    if (key.includes(pattern)) {
      throw new Error(`[FulfillmentExecutor] source_event_key contains non-deterministic pattern "${pattern}": "${key}"`);
    }
  }
}

/**
 * Full DDL contract validation before insert.
 * Throws on any violation.
 */
function validateLedgerEntry(entry: LedgerEntry): void {
  // 1. source_event_key
  validateSourceEventKey(entry.source_event_key);

  // 2. action_type ↔ status (chk_action_status_compat)
  const allowedStatuses = ACTION_STATUS_MAP[entry.action_type];
  if (!allowedStatuses) {
    throw new Error(`[FulfillmentExecutor] Invalid action_type: "${entry.action_type}"`);
  }
  if (!allowedStatuses.includes(entry.status)) {
    throw new Error(`[FulfillmentExecutor] action_type "${entry.action_type}" incompatible with status "${entry.status}". Allowed: ${allowedStatuses.join(', ')}`);
  }

  // 3. target_type (chk_target_type)
  if (!VALID_TARGET_TYPES.has(entry.target_type)) {
    throw new Error(`[FulfillmentExecutor] Invalid target_type: "${entry.target_type}". Allowed: ${[...VALID_TARGET_TYPES].join(', ')}`);
  }

  // 4. reason_code (chk_reason_code)
  if (!VALID_REASON_CODES.has(entry.reason_code)) {
    throw new Error(`[FulfillmentExecutor] Invalid reason_code: "${entry.reason_code}". Allowed: ${[...VALID_REASON_CODES].join(', ')}`);
  }

  // 5. source_subject_type (chk_source_subject_type)
  if (!VALID_SOURCE_SUBJECT_TYPES.has(entry.source_subject_type)) {
    throw new Error(`[FulfillmentExecutor] Invalid source_subject_type: "${entry.source_subject_type}". Allowed: ${[...VALID_SOURCE_SUBJECT_TYPES].join(', ')}`);
  }

  // 6. chk_parent_keys_pair: both NULL or both NOT NULL
  const hasParentEvent = entry.parent_event_key != null;
  const hasParentExec = entry.parent_execution_key != null;
  if (hasParentEvent !== hasParentExec) {
    throw new Error(`[FulfillmentExecutor] parent_event_key and parent_execution_key must be both NULL or both NOT NULL. Got event=${entry.parent_event_key}, exec=${entry.parent_execution_key}`);
  }

  // 7. chk_has_subject: at least one subject reference NOT NULL
  const hasSubject = !!(
    entry.order_id ||
    entry.source_order_id ||
    entry.source_subscription_id ||
    entry.source_offer_id ||
    entry.source_subject_ref
  );
  if (!hasSubject) {
    throw new Error(`[FulfillmentExecutor] chk_has_subject: at least one of order_id, source_order_id, source_subscription_id, source_offer_id, source_subject_ref must be NOT NULL`);
  }

  // 8. chk_batch_row_contract: batch_start requires target_type='batch'
  if (entry.action_type === 'batch_start' && entry.target_type !== 'batch') {
    throw new Error(`[FulfillmentExecutor] batch_start requires target_type='batch', got "${entry.target_type}"`);
  }
}

// ── Write ledger entry ──

export interface WriteLedgerResult {
  id: string | null;
  execution_key: string | null;
  error: string | null;
}

/**
 * Write a ledger entry to access_grant_ledger.
 * Runtime-validates the full DDL contract before insert.
 * Returns { id, execution_key } for parent propagation.
 */
export async function writeLedgerEntry(
  supabase: SupabaseClient,
  entry: LedgerEntry
): Promise<WriteLedgerResult> {
  // Runtime DDL validation — throws on violation
  validateLedgerEntry(entry);

  const { data, error } = await supabase
    .from('access_grant_ledger')
    .insert({
      source_event_type: entry.source_event_type,
      source_event_key: entry.source_event_key,
      source_subject_type: entry.source_subject_type,
      source_subject_ref: entry.source_subject_ref || null,
      source_order_id: entry.source_order_id || null,
      source_subscription_id: entry.source_subscription_id || null,
      source_offer_id: entry.source_offer_id || null,
      action_type: entry.action_type,
      reason_code: entry.reason_code,
      target_type: entry.target_type,
      target_key: entry.target_key,
      target_ref: entry.target_ref || null,
      user_id: entry.user_id || null,
      profile_id: entry.profile_id || null,
      order_id: entry.order_id || null,
      status: entry.status,
      result: entry.result || null,
      metadata: entry.metadata || null,
      error_details: entry.error_details || null,
      parent_event_key: entry.parent_event_key || null,
      parent_execution_key: entry.parent_execution_key || null,
    })
    .select('id, execution_key')
    .single();

  if (error) {
    // Check for idempotency (duplicate source_event_key)
    if (error.code === '23505' && error.message?.includes('uq_ledger_source_event_key')) {
      console.log(`[FulfillmentExecutor] Idempotent skip: ${entry.source_event_key}`);
      return { id: null, execution_key: null, error: 'idempotent_skip' };
    }
    console.error(`[FulfillmentExecutor] Ledger write failed:`, error);
    return { id: null, execution_key: null, error: error.message };
  }

  return {
    id: data?.id || null,
    execution_key: data?.execution_key || null,
    error: null,
  };
}

// ── Update ledger with post-check (MERGE, not replace) ──

/**
 * Update ledger entry with post-check result after business action completes.
 * MERGE: reads existing result, adds post_check without overwriting other fields
 * (access_start, access_end, window_days, source_window_rule, previous_end, etc.).
 * Does NOT change status.
 */
export async function updateLedgerPostCheck(
  supabase: SupabaseClient,
  ledgerId: string,
  postCheck: PostCheckResult,
  additionalResult?: Record<string, unknown>
): Promise<void> {
  // Read current result to merge
  const { data: current } = await supabase
    .from('access_grant_ledger')
    .select('result')
    .eq('id', ledgerId)
    .single();

  const existingResult = (current?.result as Record<string, unknown>) || {};

  // Merge: preserve all existing fields, add/overwrite post_check and additional fields
  const mergedResult = {
    ...existingResult,
    ...(additionalResult || {}),
    post_check: postCheck,
  };

  await supabase
    .from('access_grant_ledger')
    .update({ result: mergedResult })
    .eq('id', ledgerId);
}

// ── Build PostCheck (normalized v22 schema) ──

/**
 * Build a normalized post-check result object.
 * Input keys: entitlement, telegram, subscription, ledgerRow, targetResolution
 * Output keys: entitlement, telegram, subscription, ledger_row, target_resolution
 */
export function buildPostCheck(checks: {
  entitlement?: { status: string; ref?: string; details?: string };
  telegram?: { status: string; ref?: string; details?: string };
  subscription?: { status: string; ref?: string; details?: string };
  ledgerRow?: { status: string; ref?: string; details?: string };
  targetResolution?: { status: string; ref?: string; details?: string };
}): PostCheckResult {
  const toItem = (
    input?: { status: string; ref?: string; details?: string }
  ): PostCheckItem => {
    if (!input) {
      return { applicability: 'not_applicable', status: null };
    }
    // Map old-style statuses to normalized pass/warn/fail
    let normalizedStatus: 'pass' | 'warn' | 'fail' | null;
    const s = input.status.toLowerCase();
    if (['pass', 'written', 'matched', 'extended', 'created', 'queued', 'granted', 'ok', 'found'].includes(s)) {
      normalizedStatus = 'pass';
    } else if (['warn', 'partial', 'degraded'].includes(s)) {
      normalizedStatus = 'warn';
    } else if (['fail', 'failed', 'error', 'missing', 'not_found'].includes(s)) {
      normalizedStatus = 'fail';
    } else if (['skipped', 'not_applicable', 'n/a'].includes(s)) {
      return { applicability: 'not_applicable', status: null, ref: input.ref, details: input.details };
    } else {
      // Unknown status → treat as pass with details
      normalizedStatus = 'pass';
    }
    return {
      applicability: 'required',
      status: normalizedStatus,
      ref: input.ref,
      details: input.details || input.status,
    };
  };

  return {
    entitlement: toItem(checks.entitlement),
    telegram: toItem(checks.telegram),
    subscription: toItem(checks.subscription),
    ledger_row: toItem(checks.ledgerRow),
    target_resolution: toItem(checks.targetResolution),
  };
}
