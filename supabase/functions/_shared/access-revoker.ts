/**
 * Phase 1: AccessRevoker — centralized ledger writer for revoke/expire paths.
 * 
 * Contract:
 * - AccessRevoker does NOT create subscriptions.
 * - AccessRevoker does NOT extend subscriptions.
 * - AccessRevoker reads authoritative sources and checks for other active sources.
 * - AccessRevoker removes projection only if no other active sources exist.
 * - AccessRevoker writes a ledger row for every revocation decision.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { writeLedgerEntry, type LedgerEntry } from './fulfillment-executor.ts';
import { hasValidAccess } from './accessValidation.ts';

export interface RevokeContext {
  userId: string;
  clubId?: string | null;
  subscriptionId?: string | null;
  reason: string;
  sourceEventType: 'webhook' | 'cron' | 'admin' | 'system';
  sourceEventKey: string;
  sourceSubjectType: string;
  sourceSubjectRef?: string | null;
  parentEventKey?: string | null;
  parentExecutionKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RevokeResult {
  revoked: boolean;
  skippedReason?: string;
  otherActiveSource?: string;
  ledgerId?: string | null;
}

/**
 * Execute a revocation with access check and ledger write.
 * 
 * 1. Check if user has other valid access sources.
 * 2. If yes → skip revoke, write ledger with action_type='skip'.
 * 3. If no → proceed with revoke, write ledger with action_type='revoke'.
 */
export async function executeRevoke(
  supabase: SupabaseClient,
  ctx: RevokeContext
): Promise<RevokeResult> {
  // Check for other active access sources
  const accessCheck = await hasValidAccess(supabase, ctx.userId, ctx.clubId || undefined);

  if (accessCheck.valid) {
    // User has other active access → skip revoke
    const ledgerEntry: LedgerEntry = {
      source_event_type: ctx.sourceEventType,
      source_event_key: ctx.sourceEventKey,
      source_subject_type: ctx.sourceSubjectType,
      source_subject_ref: ctx.sourceSubjectRef || null,
      source_subscription_id: ctx.subscriptionId || null,
      action_type: 'skip',
      reason_code: ctx.reason,
      target_type: 'telegram_access',
      target_key: `${ctx.userId}:${ctx.clubId || 'global'}`,
      user_id: ctx.userId,
      status: 'skipped',
      result: {
        skip_reason: 'other_active_source',
        existing_ref: `${accessCheck.source}:${accessCheck.subscriptionId || accessCheck.entitlementId || accessCheck.manualAccessId || 'unknown'}`,
        other_active_sources_checked: true,
      },
      parent_event_key: ctx.parentEventKey || null,
      parent_execution_key: ctx.parentExecutionKey || null,
      metadata: ctx.metadata || null,
    };

    const { id } = await writeLedgerEntry(supabase, ledgerEntry);

    return {
      revoked: false,
      skippedReason: 'other_active_source',
      otherActiveSource: `${accessCheck.source}:${accessCheck.endAt || 'no_end'}`,
      ledgerId: id,
    };
  }

  // No other active access → proceed with revoke, write ledger
  const ledgerEntry: LedgerEntry = {
    source_event_type: ctx.sourceEventType,
    source_event_key: ctx.sourceEventKey,
    source_subject_type: ctx.sourceSubjectType,
    source_subject_ref: ctx.sourceSubjectRef || null,
    source_subscription_id: ctx.subscriptionId || null,
    action_type: 'revoke',
    reason_code: ctx.reason,
    target_type: 'telegram_access',
    target_key: `${ctx.userId}:${ctx.clubId || 'global'}`,
    user_id: ctx.userId,
    status: 'completed',
    result: {
      revoked_from: ctx.subscriptionId || ctx.clubId || 'direct',
      previous_access_end: null, // Caller can enrich this
      reconcile_basis: ctx.reason,
      other_active_sources_checked: true,
      kept_projections: [],
    },
    parent_event_key: ctx.parentEventKey || null,
    parent_execution_key: ctx.parentExecutionKey || null,
    metadata: ctx.metadata || null,
  };

  const { id } = await writeLedgerEntry(supabase, ledgerEntry);

  return {
    revoked: true,
    ledgerId: id,
  };
}
