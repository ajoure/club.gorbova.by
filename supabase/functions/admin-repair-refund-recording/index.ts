// PATCH-REFUND-SOT-RPC-RECOVERY-2026-05
//
// Узкая admin-only функция для восстановления локальной записи возврата
// в случаях, когда bePaid refund реально прошёл (есть `bepaid_refund_uid`),
// но `record_refund_atomic` упала и оставила audit
// `admin.subscription.refund_db_recording_failed`.
//
// Жёсткие правила:
//  - НЕ вызывает bePaid API ни в каком виде;
//  - НЕ выполняет access action (revoke/reduce/keep) — это отдельное admin-решение;
//  - НЕ генерирует новый refund_uid — обязан использовать original uid
//    из audit_log или из явного параметра;
//  - Идемпотентность гарантирована тем же guard'ом внутри record_refund_atomic
//    (по provider_payment_id + transaction_type='refund').
//  - Доступ: только super_admin.
//
// Поддерживаемые режимы вызова:
//  A) { audit_log_id: uuid }
//     — читает audit (action='admin.subscription.refund_db_recording_failed'),
//        достаёт bepaid_refund_uid, order_id, refund_amount, parent_payment_id,
//        вызывает record_refund_atomic.
//  B) { dry_run: true }
//     — возвращает список всех необработанных failed-audit-кейсов с пометкой
//        can_repair / manual_review (refund_uid отсутствует или amount=0).
//  C) { audit_log_id: uuid, dry_run: true }
//     — резолвит конкретный кейс и говорит, можно ли его repair.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface FailedAuditMeta {
  order_id?: string;
  order_number?: string;
  refund_amount?: number;
  bepaid_refund_uid?: string;
  error?: string;
  requires_manual_repair?: boolean;
}

interface RepairCandidate {
  audit_log_id: string;
  created_at: string;
  order_id: string | null;
  order_number: string | null;
  bepaid_refund_uid: string | null;
  refund_amount: number | null;
  parent_payment_id: string | null;
  parent_payment_uid: string | null;
  target_user_id: string | null;
  actor_user_id: string | null;
  already_repaired: boolean;
  can_repair: boolean;
  manual_review_reason: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JWT' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminUserId = claimsData.user.id;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Super-admin only — repair-инструмент критичный, не для рядовых админов.
    const { data: isSuperAdmin } = await supabase.rpc('has_role_v2', {
      _user_id: adminUserId,
      _role_code: 'super_admin',
    });
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ success: false, error: 'super_admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { audit_log_id, dry_run } = body as { audit_log_id?: string; dry_run?: boolean };

    // ---- Helper: resolve candidate from a single failed-audit row ----
    const resolveCandidate = async (auditRow: any): Promise<RepairCandidate> => {
      const meta = (auditRow.meta || {}) as FailedAuditMeta;
      const orderId = meta.order_id ?? null;
      const refundUid = meta.bepaid_refund_uid ?? null;
      const refundAmount = typeof meta.refund_amount === 'number' ? meta.refund_amount : null;

      let alreadyRepaired = false;
      if (refundUid) {
        const { data: existing } = await supabase
          .from('payments_v2')
          .select('id')
          .eq('provider', 'bepaid')
          .eq('provider_payment_id', refundUid)
          .eq('transaction_type', 'refund')
          .maybeSingle();
        if (existing) alreadyRepaired = true;
      }

      let parentPaymentId: string | null = null;
      let parentPaymentUid: string | null = null;
      if (orderId) {
        const { data: parent } = await supabase
          .from('payments_v2')
          .select('id, provider_payment_id')
          .eq('order_id', orderId)
          .eq('provider', 'bepaid')
          .eq('status', 'succeeded')
          .gt('amount', 0)
          .order('paid_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (parent) {
          parentPaymentId = parent.id;
          parentPaymentUid = parent.provider_payment_id;
        }
      }

      let canRepair = true;
      let manualReason: string | null = null;
      if (!refundUid) { canRepair = false; manualReason = 'manual_review_refund_uid_missing'; }
      else if (!orderId) { canRepair = false; manualReason = 'manual_review_order_id_missing'; }
      else if (!refundAmount || refundAmount <= 0) { canRepair = false; manualReason = 'manual_review_amount_missing_or_zero'; }
      else if (!parentPaymentId) { canRepair = false; manualReason = 'manual_review_parent_payment_not_found'; }
      else if (alreadyRepaired) { canRepair = false; manualReason = null; /* already done */ }

      return {
        audit_log_id: auditRow.id,
        created_at: auditRow.created_at,
        order_id: orderId,
        order_number: meta.order_number ?? null,
        bepaid_refund_uid: refundUid,
        refund_amount: refundAmount,
        parent_payment_id: parentPaymentId,
        parent_payment_uid: parentPaymentUid,
        target_user_id: auditRow.target_user_id ?? null,
        actor_user_id: auditRow.actor_user_id ?? null,
        already_repaired: alreadyRepaired,
        can_repair: canRepair,
        manual_review_reason: manualReason,
      };
    };

    // ============ MODE B: full dry-run sweep ============
    if (!audit_log_id && dry_run) {
      const { data: rows, error } = await supabase
        .from('audit_logs')
        .select('id, target_user_id, actor_user_id, created_at, meta')
        .eq('action', 'admin.subscription.refund_db_recording_failed')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const candidates: RepairCandidate[] = [];
      for (const r of rows ?? []) candidates.push(await resolveCandidate(r));

      const summary = {
        total: candidates.length,
        already_repaired: candidates.filter(c => c.already_repaired).length,
        can_repair: candidates.filter(c => c.can_repair).length,
        manual_review: candidates.filter(c => !c.can_repair && !c.already_repaired).length,
      };
      return new Response(JSON.stringify({ success: true, mode: 'dry_run_sweep', summary, candidates }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============ MODE A / C: single audit_log_id ============
    if (!audit_log_id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'audit_log_id required (or pass {dry_run:true} for sweep)',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: auditRow, error: auditErr } = await supabase
      .from('audit_logs')
      .select('id, target_user_id, actor_user_id, created_at, meta, action')
      .eq('id', audit_log_id)
      .maybeSingle();
    if (auditErr || !auditRow) {
      return new Response(JSON.stringify({ success: false, error: 'audit_log not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (auditRow.action !== 'admin.subscription.refund_db_recording_failed') {
      return new Response(JSON.stringify({
        success: false,
        error: `audit_log.action must be 'admin.subscription.refund_db_recording_failed', got '${auditRow.action}'`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cand = await resolveCandidate(auditRow);

    if (dry_run) {
      return new Response(JSON.stringify({ success: true, mode: 'dry_run_single', candidate: cand }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Execute
    if (cand.already_repaired) {
      return new Response(JSON.stringify({
        success: true,
        mode: 'execute',
        idempotent: true,
        message: 'refund-row already exists for this bepaid_refund_uid',
        candidate: cand,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!cand.can_repair) {
      return new Response(JSON.stringify({
        success: false,
        mode: 'execute',
        error: cand.manual_review_reason ?? 'cannot_repair',
        candidate: cand,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Reconstruct minimal bePaid response payload from the original failed-audit meta.
    const repairBepaidResponse = {
      uid: cand.bepaid_refund_uid,
      status: 'successful',
      message: 'recovery_via_admin_repair_refund_recording',
      recovered_from_audit_log_id: cand.audit_log_id,
      recovered_at: new Date().toISOString(),
    };

    const { data: rpcResult, error: rpcError } = await supabase.rpc('record_refund_atomic', {
      p_order_id: cand.order_id!,
      p_parent_payment_id: cand.parent_payment_id!,
      p_refund_amount: cand.refund_amount!,
      p_refund_uid: cand.bepaid_refund_uid!,
      p_refund_reason: `Recovery after RPC fix (PATCH-REFUND-SOT-RPC-RECOVERY-2026-05). Original failed audit_log_id=${cand.audit_log_id}`,
      p_actor_user_id: adminUserId,
      p_target_user_id: cand.target_user_id!,
      p_bepaid_response: repairBepaidResponse,
    });

    if (rpcError) {
      return new Response(JSON.stringify({
        success: false,
        mode: 'execute',
        error: 'record_refund_atomic_failed',
        rpc_error: String(rpcError.message ?? rpcError),
        candidate: cand,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Recovery audit (отдельный от внутреннего refund_recorded внутри RPC, чтобы трассировать инструмент)
    await supabase.from('audit_logs').insert({
      actor_user_id: adminUserId,
      target_user_id: cand.target_user_id,
      actor_type: 'user',
      actor_label: 'admin-repair-refund-recording',
      action: 'admin.subscription.refund_recovered_via_admin_repair',
      meta: {
        source_audit_log_id: cand.audit_log_id,
        order_id: cand.order_id,
        order_number: cand.order_number,
        bepaid_refund_uid: cand.bepaid_refund_uid,
        parent_payment_id: cand.parent_payment_id,
        refund_amount: cand.refund_amount,
        rpc_result: rpcResult,
        patch: 'PATCH-REFUND-SOT-RPC-RECOVERY-2026-05',
        note: 'access_action_not_executed_admin_decision_required',
      },
    });

    return new Response(JSON.stringify({
      success: true,
      mode: 'execute',
      idempotent: !!(rpcResult as any)?.idempotent,
      rpc_result: rpcResult,
      candidate: cand,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('admin-repair-refund-recording error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
