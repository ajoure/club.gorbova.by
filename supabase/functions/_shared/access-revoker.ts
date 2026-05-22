/**
 * Phase 1: AccessRevoker — generic centralized ledger writer for revoke/expire paths.
 * PATCH v22.3: Generic helper, not telegram-only.
 * 
 * Contract:
 * - AccessRevoker does NOT create subscriptions.
 * - AccessRevoker does NOT extend subscriptions.
 * - Caller MUST provide targetType, targetKey, targetRef, reasonCode, reconcileBasis.
 * - AccessRevoker reads authoritative sources and checks for other active sources.
 * - AccessRevoker removes projection only if no other active sources exist.
 * - AccessRevoker writes a ledger row for every revocation decision.
 * - Helper does NOT "invent" any field — all business semantics come from caller.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { writeLedgerEntry, type LedgerEntry, type LedgerTargetType, type LedgerReasonCode, type LedgerSourceEventType, type LedgerSourceSubjectType } from './fulfillment-executor.ts';
import { hasCommercialAccess } from './accessValidation.ts';

export interface RevokeContext {
  userId: string;
  profileId?: string | null;
  orderId?: string | null;
  // Target descriptor — caller MUST provide
  targetType: LedgerTargetType;
  targetKey: string;
  targetRef?: string | null;
  // Subscription context
  subscriptionId?: string | null;
  // Reason — from caller
  reasonCode: LedgerReasonCode;
  reconcileBasis: string;
  // Source fields — from caller
  sourceEventType: LedgerSourceEventType;
  sourceEventKey: string;
  sourceSubjectType: LedgerSourceSubjectType;
  sourceSubjectRef?: string | null;
  // Parent propagation
  parentEventKey?: string | null;
  parentExecutionKey?: string | null;
  // Extra
  metadata?: Record<string, unknown>;
  // Club ID for access check (derived from target or passed explicitly)
  clubId?: string | null;
}

export interface RevokeResult {
  revoked: boolean;
  skippedReason?: string;
  otherActiveSource?: string;
  ledgerId?: string | null;
  executionKey?: string | null;
}

/**
 * Execute a revocation with access check and ledger write.
 * 
 * 1. Check if user has other valid access sources (via authoritative tables).
 * 2. If yes → skip revoke, write ledger with action_type='skip', status='skipped'.
 * 3. If no → proceed with revoke, write ledger with action_type='revoke', status='revoked'.
 */
export async function executeRevoke(
  supabase: SupabaseClient,
  ctx: RevokeContext
): Promise<RevokeResult> {
  // COMMERCIAL-ONLY (2026-05-22): revoke skip только если есть реальное коммерческое право.
  const accessCheck = await hasCommercialAccess(supabase, ctx.userId, ctx.clubId || undefined);

  if (accessCheck.valid) {
    // User has other active access → skip revoke
    const ledgerEntry: LedgerEntry = {
      source_event_type: ctx.sourceEventType,
      source_event_key: ctx.sourceEventKey,
      source_subject_type: ctx.sourceSubjectType,
      source_subject_ref: ctx.sourceSubjectRef || null,
      source_subscription_id: ctx.subscriptionId || null,
      action_type: 'skip',
      reason_code: ctx.reasonCode,
      target_type: ctx.targetType,
      target_key: ctx.targetKey,
      target_ref: ctx.targetRef || null,
      user_id: ctx.userId,
      profile_id: ctx.profileId || null,
      order_id: ctx.orderId || null,
      status: 'skipped',
      result: {
        skip_reason: 'other_active_source',
        reconcile_basis: ctx.reconcileBasis,
        existing_ref: `${accessCheck.source}:${accessCheck.subscriptionId || accessCheck.entitlementId || accessCheck.manualAccessId || 'unknown'}`,
        other_active_sources_checked: true,
      },
      parent_event_key: ctx.parentEventKey || null,
      parent_execution_key: ctx.parentExecutionKey || null,
      metadata: ctx.metadata || null,
    };

    const { id, execution_key } = await writeLedgerEntry(supabase, ledgerEntry);

    return {
      revoked: false,
      skippedReason: 'other_active_source',
      otherActiveSource: `${accessCheck.source}:${accessCheck.endAt || 'no_end'}`,
      ledgerId: id,
      executionKey: execution_key,
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
    reason_code: ctx.reasonCode,
    target_type: ctx.targetType,
    target_key: ctx.targetKey,
    target_ref: ctx.targetRef || null,
    user_id: ctx.userId,
    profile_id: ctx.profileId || null,
    order_id: ctx.orderId || null,
    status: 'revoked',
    result: {
      revoked_from: ctx.subscriptionId || ctx.targetKey || 'direct',
      previous_access_end: null, // Caller can enrich this
      reconcile_basis: ctx.reconcileBasis,
      other_active_sources_checked: true,
      kept_projections: [],
    },
    parent_event_key: ctx.parentEventKey || null,
    parent_execution_key: ctx.parentExecutionKey || null,
    metadata: ctx.metadata || null,
  };

  const { id, execution_key } = await writeLedgerEntry(supabase, ledgerEntry);

  return {
    revoked: true,
    ledgerId: id,
    executionKey: execution_key,
  };
}
