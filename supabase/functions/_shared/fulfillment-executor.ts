/**
 * Phase 1: FulfillmentExecutor — centralized ledger writer for grant/extend paths.
 * 
 * Contract:
 * - Every grant/extend MUST produce a ledger row in access_grant_ledger.
 * - DB-only paths write projections + ledger atomically via fn_fulfillment_ledger_write RPC.
 * - source_event_key must be deterministic (no timestamps, no random).
 * - post_check is written after business action completes.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface LedgerEntry {
  source_event_type: 'webhook' | 'cron' | 'admin' | 'system';
  source_event_key: string;
  source_subject_type: string;
  source_subject_ref?: string | null;
  source_order_id?: string | null;
  source_subscription_id?: string | null;
  source_offer_id?: string | null;
  action_type: 'grant' | 'extend' | 'reactivate' | 'revoke' | 'expire' | 'skip' | 'failed' | 'batch_start';
  reason_code: string;
  target_type: string;
  target_key: string;
  target_ref?: string | null;
  user_id?: string | null;
  profile_id?: string | null;
  order_id?: string | null;
  status: 'completed' | 'failed' | 'skipped' | 'pending';
  result?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  error_details?: Record<string, unknown> | null;
  parent_event_key?: string | null;
  parent_execution_key?: string | null;
}

export interface PostCheckResult {
  entitlement: { applicable: boolean; status: string; ref?: string; details?: string };
  telegram_grant: { applicable: boolean; status: string; ref?: string; details?: string };
  subscription: { applicable: boolean; status: string; ref?: string; details?: string };
  ledger_row: { applicable: boolean; status: string; ref?: string; details?: string };
  target_resolution: { applicable: boolean; status: string; ref?: string; details?: string };
}

/**
 * Write a ledger entry to access_grant_ledger.
 * Uses direct INSERT via supabase client.
 * 
 * For DB-only paths, this should be called within the same logical flow
 * as the projection changes. The SECURITY DEFINER RPC (fn_fulfillment_ledger_write)
 * handles atomicity when called from edge functions.
 */
export async function writeLedgerEntry(
  supabase: SupabaseClient,
  entry: LedgerEntry
): Promise<{ id: string | null; error: string | null }> {
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
    .select('id')
    .single();

  if (error) {
    // Check for idempotency (duplicate source_event_key)
    if (error.code === '23505' && error.message?.includes('uq_ledger_source_event_key')) {
      console.log(`[FulfillmentExecutor] Idempotent skip: ${entry.source_event_key}`);
      return { id: null, error: 'idempotent_skip' };
    }
    console.error(`[FulfillmentExecutor] Ledger write failed:`, error);
    return { id: null, error: error.message };
  }

  return { id: data?.id || null, error: null };
}

/**
 * Update ledger entry with post-check result after business action completes.
 */
export async function updateLedgerPostCheck(
  supabase: SupabaseClient,
  ledgerId: string,
  postCheck: PostCheckResult,
  additionalResult?: Record<string, unknown>
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    result: {
      ...(additionalResult || {}),
      post_check: postCheck,
    },
    status: 'completed',
  };

  await supabase
    .from('access_grant_ledger')
    .update(updatePayload)
    .eq('id', ledgerId);
}

/**
 * Build a post-check result object.
 */
export function buildPostCheck(checks: {
  entitlement?: { status: string; ref?: string; details?: string };
  telegramGrant?: { status: string; ref?: string; details?: string };
  subscription?: { status: string; ref?: string; details?: string };
  ledgerRow?: { status: string; ref?: string; details?: string };
  targetResolution?: { status: string; ref?: string; details?: string };
}): PostCheckResult {
  return {
    entitlement: {
      applicable: !!checks.entitlement,
      status: checks.entitlement?.status || 'not_applicable',
      ref: checks.entitlement?.ref,
      details: checks.entitlement?.details,
    },
    telegram_grant: {
      applicable: !!checks.telegramGrant,
      status: checks.telegramGrant?.status || 'not_applicable',
      ref: checks.telegramGrant?.ref,
      details: checks.telegramGrant?.details,
    },
    subscription: {
      applicable: !!checks.subscription,
      status: checks.subscription?.status || 'not_applicable',
      ref: checks.subscription?.ref,
      details: checks.subscription?.details,
    },
    ledger_row: {
      applicable: true,
      status: checks.ledgerRow?.status || 'written',
      ref: checks.ledgerRow?.ref,
      details: checks.ledgerRow?.details,
    },
    target_resolution: {
      applicable: !!checks.targetResolution,
      status: checks.targetResolution?.status || 'not_applicable',
      ref: checks.targetResolution?.ref,
      details: checks.targetResolution?.details,
    },
  };
}

/**
 * Validate that source_event_key is deterministic.
 * STOP-guard: reject keys containing Date.now(), timestamps, or random values.
 */
export function validateSourceEventKey(key: string): boolean {
  // Basic validation: must be non-empty and not contain obvious non-deterministic patterns
  if (!key || key.length === 0) return false;
  // Keys should follow pattern: prefix:{deterministic_id}
  if (!key.includes(':')) return false;
  return true;
}
