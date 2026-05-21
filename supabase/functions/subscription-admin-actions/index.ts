import { createClient } from 'npm:@supabase/supabase-js@2';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { executeRevoke, type RevokeContext } from '../_shared/access-revoker.ts';
import { writeLedgerEntry, type LedgerEntry } from '../_shared/fulfillment-executor.ts';
import { syncEntitlement, hasOtherActiveAccessSource } from '../_shared/entitlement-sync.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Send Telegram notification helper
async function sendTelegramNotification(
  supabase: any,
  userId: string,
  messageType: string,
  customMessage?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('telegram-send-notification', {
      body: {
        user_id: userId,
        message_type: messageType,
        custom_message: customMessage,
      },
    });
    
    if (error) {
      console.log('Telegram notification error:', error.message);
      return { success: false, error: error.message };
    }
    
    return { success: data?.success ?? false, error: data?.error };
  } catch (err) {
    console.log('Telegram notification exception:', err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Cancel order in GetCourse
async function cancelGetCourseOrder(
  email: string,
  offerId: number | string,
  orderNumber: string,
  reason: string,
  amount: number = 0,
  gcDealId?: string | number // GetCourse deal_id to update existing deal
): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping cancel');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log('No offerId for GetCourse cancel, skipping');
    return { success: false, error: 'No offer ID' };
  }
  
  try {
    console.log(`Canceling GetCourse order: email=${email}, offerId=${offerId}, amount=${amount}, gcDealId=${gcDealId}`);
    
    // Build deal object - use deal_number to update existing deal if we have gc_deal_id
    const dealParams: Record<string, any> = {
      offer_code: offerId.toString(),
      deal_cost: amount, // Required field for GetCourse
      deal_is_paid: 0, // Устанавливаем ложный статус оплаты вместо отмены статуса
      deal_comment: `Отменено администратором. ${reason}. Order: ${orderNumber}`,
    };
    
    // CRITICAL: Pass deal_number to update existing deal instead of creating new one
    if (gcDealId) {
      dealParams.deal_number = parseInt(String(gcDealId), 10);
      console.log(`Using deal_number=${dealParams.deal_number} to update existing GetCourse deal`);
    }
    
    const params = {
      user: {
        email: email,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: dealParams,
    };
    
    console.log('GetCourse cancel params:', JSON.stringify(params, null, 2));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('GetCourse cancel response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    if (data.result?.success === true) {
      console.log('Order successfully cancelled in GetCourse');
      return { success: true };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse cancel error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse cancel API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// Update order in GetCourse (for extend/modify)
async function updateGetCourseOrder(
  email: string,
  offerId: number | string,
  orderNumber: string,
  newEndDate: string,
  amount: number = 0,
  gcDealId?: string | number // GetCourse deal_id to update existing deal
): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping update');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log('No offerId for GetCourse update, skipping');
    return { success: false, error: 'No offer ID' };
  }
  
  try {
    console.log(`Updating GetCourse order: email=${email}, offerId=${offerId}, newEndDate=${newEndDate}, gcDealId=${gcDealId}`);
    
    // Build deal object - use deal_number to update existing deal if we have gc_deal_id
    const dealParams: Record<string, any> = {
      offer_code: offerId.toString(),
      deal_cost: amount,
      deal_status: 'in_work', // Active status
      deal_is_paid: 1,
      deal_comment: `Доступ продлён до ${newEndDate}. Order: ${orderNumber}`,
    };
    
    // CRITICAL: Pass deal_number to update existing deal instead of creating new one
    if (gcDealId) {
      dealParams.deal_number = parseInt(String(gcDealId), 10);
      console.log(`Using deal_number=${dealParams.deal_number} to update existing GetCourse deal`);
    }
    
    const params = {
      user: {
        email: email,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: dealParams,
    };
    
    console.log('GetCourse update params:', JSON.stringify(params, null, 2));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('GetCourse update response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    if (data.result?.success === true) {
      console.log('Order successfully updated in GetCourse');
      return { success: true };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse update error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse update API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate JWT and check admin role
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
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

    // Check if user is admin or super_admin
    const { data: isAdminRole } = await supabase.rpc('has_role_v2', {
      _user_id: adminUserId,
      _role_code: 'admin'
    });
    const { data: isSuperAdmin } = await supabase.rpc('has_role_v2', {
      _user_id: adminUserId,
      _role_code: 'super_admin'
    });
    const isAdmin = isAdminRole || isSuperAdmin;

    if (!isAdmin) {
      return new Response(JSON.stringify({ success: false, error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, subscription_id, order_id, days, new_end_date, refund_amount, refund_reason, access_action, reduce_days } = body;

    console.log(`Admin ${adminUserId} performing ${action}`);

    // Handle refund separately since it uses order_id not subscription_id
    if (action === 'refund') {
      if (!order_id) {
        return new Response(JSON.stringify({ success: false, error: 'order_id required for refund' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!refund_reason || !refund_reason.trim()) {
        return new Response(JSON.stringify({ success: false, error: 'refund_reason required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get order with related payment
      const { data: order, error: orderError } = await supabase
        .from('orders_v2')
        .select('*, payments_v2(*)')
        .eq('id', order_id)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ success: false, error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (order.status !== 'paid') {
        return new Response(JSON.stringify({ success: false, error: 'Only paid orders can be refunded' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const actualRefundAmount = refund_amount || order.final_price;
      const payments = order.payments_v2 as any[];
      const successfulPayment = payments?.find((p: any) => p.status === 'succeeded' && p.provider_payment_id);
      
      let bepaidRefundResult: any = null;
      let bepaidRefundError: string | null = null;
      let bepaidAlreadyRefunded = false;

      // Process refund through bePaid if we have a payment UID
      if (successfulPayment?.provider_payment_id) {
        // PATCH-P0.9.1: Strict creds
        const credsResult = await getBepaidCredsStrict(supabase);
        
        if (isBepaidCredsError(credsResult)) {
          console.log('BEPAID_CREDS_MISSING, skipping refund: ' + credsResult.error);
        } else {
          const bepaidCreds = credsResult;
          try {
            const bepaidAuth = createBepaidAuthHeader(bepaidCreds);
            const refundPayload = {
              request: {
                parent_uid: successfulPayment.provider_payment_id,
                amount: Math.round(actualRefundAmount * 100), // Convert to minimal units
                reason: refund_reason.trim().slice(0, 255),
              },
            };

            console.log(`Sending refund to bePaid: parent_uid=${successfulPayment.provider_payment_id}, amount=${refundPayload.request.amount}`);

            const bepaidResponse = await fetch('https://gateway.bepaid.by/transactions/refunds', {
              method: 'POST',
              headers: {
                'Authorization': bepaidAuth,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify(refundPayload),
            });

            bepaidRefundResult = await bepaidResponse.json();
            console.log('bePaid refund response:', JSON.stringify(bepaidRefundResult));

            // Detect nested error envelope: { response: { message, errors: { base: [...] } } }
            const nestedResp = (bepaidRefundResult as any)?.response;
            const nestedMsg: string = nestedResp?.message || '';
            const nestedBaseErrors: string[] = nestedResp?.errors?.base || [];
            const combinedErrText = [nestedMsg, ...nestedBaseErrors].join(' ').toLowerCase();
            const alreadyRefunded = combinedErrText.includes('refunded already')
              || combinedErrText.includes('already refunded');

            if (bepaidRefundResult.transaction?.status === 'successful') {
              console.log(`bePaid refund successful: uid=${bepaidRefundResult.transaction.uid}`);
            } else if (alreadyRefunded) {
              // Idempotent: bePaid уже вернул этот платёж. Не считаем ошибкой.
              bepaidAlreadyRefunded = true;
              bepaidRefundError = 'bepaid_already_refunded';
              console.warn('[refund] bePaid reports payment already refunded — treating as idempotent skip');
            } else if (bepaidRefundResult.transaction?.status === 'failed') {
              bepaidRefundError = bepaidRefundResult.transaction.message || 'Refund failed';
              console.error('bePaid refund failed:', bepaidRefundError);
            } else if (bepaidRefundResult.errors || nestedResp?.errors) {
              bepaidRefundError = bepaidRefundResult.message || nestedMsg || JSON.stringify(bepaidRefundResult.errors || nestedResp?.errors);
              console.error('bePaid refund error:', bepaidRefundError);
            }
          } catch (err) {
            bepaidRefundError = err instanceof Error ? err.message : String(err);
            console.error('bePaid API error:', bepaidRefundError);
          }
        }
      } else {
        console.log('No successful payment found with provider_payment_id, skipping bePaid refund');
      }

      // Check if bePaid refund succeeded (or if there was no bePaid payment to refund)
      const hasBepaidPayment = !!successfulPayment?.provider_payment_id;
      const bepaidRefundSuccessful = bepaidRefundResult?.transaction?.status === 'successful';
      
      // PATCH-REFUND-SOT-RPC-RECOVERY-2026-05:
      // bePaid вернул «refunded already» → пытаемся идемпотентно записать refund-row
      // через record_refund_atomic, но ТОЛЬКО при наличии доказанного refund_uid.
      // Источники uid (по приоритету):
      //   1) bepaidRefundResult.transaction.uid (если bePaid внезапно отдал)
      //   2) original failed-audit `admin.subscription.refund_db_recording_failed`
      //      для того же order_id (наша исходная попытка отправки в bePaid).
      // Если uid не найден → пишем audit `manual_review_refund_uid_missing`,
      // никаких записей в payments_v2, ничего не выдумываем.
      if (hasBepaidPayment && !bepaidRefundSuccessful && bepaidAlreadyRefunded) {
        let recoveredRefundUid: string | null = bepaidRefundResult?.transaction?.uid || null;
        let recoveredAuditId: string | null = null;
        if (!recoveredRefundUid) {
          const { data: priorFailed } = await supabase
            .from('audit_logs')
            .select('id, meta')
            .eq('action', 'admin.subscription.refund_db_recording_failed')
            .contains('meta', { order_id })
            .order('created_at', { ascending: false })
            .limit(1);
          const meta0 = (priorFailed?.[0]?.meta as any) || null;
          if (meta0?.bepaid_refund_uid) {
            recoveredRefundUid = String(meta0.bepaid_refund_uid);
            recoveredAuditId = String(priorFailed![0].id);
          }
        }

        let rpcRecoveryResult: any = null;
        let rpcRecoveryError: string | null = null;
        let recoveryAction: 'rpc_called' | 'manual_review_refund_uid_missing' = 'manual_review_refund_uid_missing';

        if (recoveredRefundUid && successfulPayment) {
          recoveryAction = 'rpc_called';
          const { data: rpcOut, error: rpcErr } = await supabase.rpc('record_refund_atomic', {
            p_order_id: order_id,
            p_parent_payment_id: successfulPayment.id,
            p_refund_amount: actualRefundAmount,
            p_refund_uid: recoveredRefundUid,
            p_refund_reason: refund_reason,
            p_actor_user_id: adminUserId,
            p_target_user_id: order.user_id,
            p_bepaid_response: {
              status: 'already_refunded',
              uid: recoveredRefundUid,
              message: 'Recovery via bepaidAlreadyRefunded branch — PATCH-REFUND-SOT-RPC-RECOVERY-2026-05',
              recovered_from_audit_log_id: recoveredAuditId,
              upstream_bepaid_response: bepaidRefundResult,
            },
          });
          if (rpcErr) rpcRecoveryError = String(rpcErr.message || rpcErr);
          else rpcRecoveryResult = rpcOut;
        }

        await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: order.user_id,
          actor_type: 'user',
          actor_label: 'subscription-admin-actions[refund][already_refunded]',
          action: recoveryAction === 'rpc_called'
            ? (rpcRecoveryError
                ? 'admin.subscription.refund_already_refunded_recovery_failed'
                : 'admin.subscription.refund_already_refunded_recovered')
            : 'admin.subscription.refund_already_refunded_manual_review',
          meta: {
            order_id,
            order_number: order.order_number,
            parent_payment_uid: successfulPayment?.provider_payment_id,
            recovered_refund_uid: recoveredRefundUid,
            recovered_from_audit_log_id: recoveredAuditId,
            rpc_result: rpcRecoveryResult,
            rpc_error: rpcRecoveryError,
            bepaid_response: bepaidRefundResult,
            patch: 'PATCH-REFUND-SOT-RPC-RECOVERY-2026-05',
            manual_review_reason: recoveryAction === 'manual_review_refund_uid_missing'
              ? 'refund_uid_not_found_in_bepaid_response_nor_prior_failed_audit'
              : null,
          },
        });

        return new Response(JSON.stringify({
          success: !!rpcRecoveryResult && !rpcRecoveryError,
          idempotent: true,
          recovery_action: recoveryAction,
          rpc_result: rpcRecoveryResult,
          rpc_error: rpcRecoveryError,
          error: rpcRecoveryError
            ? `Платёж уже возвращён в bePaid, но локальная запись refund не создана: ${rpcRecoveryError}`
            : (recoveryAction === 'manual_review_refund_uid_missing'
                ? 'Платёж уже возвращён в bePaid, refund_uid не найден — требуется ручная проверка (admin-repair-refund-recording).'
                : 'Платёж уже возвращён в bePaid — локальная запись refund восстановлена.'),
          bepaid_error: 'bepaid_already_refunded',
          bepaid_response: bepaidRefundResult,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // If there was a bePaid payment and refund failed, return error - don't update order
      if (hasBepaidPayment && !bepaidRefundSuccessful) {
        console.error(`bePaid refund failed for order ${order_id}, NOT marking as refunded`);

        await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: order.user_id,
          action: 'admin.subscription.refund_failed',
          meta: {
            order_id,
            order_number: order.order_number,
            refund_amount: actualRefundAmount,
            refund_reason: refund_reason,
            bepaid_error: bepaidRefundError,
            bepaid_response: bepaidRefundResult,
          },
        });

        return new Response(JSON.stringify({
          success: false,
          error: bepaidRefundError || 'Ошибка возврата в bePaid. Статус заказа не изменён.',
          bepaid_error: bepaidRefundError,
          bepaid_response: bepaidRefundResult,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // PATCH partial-refund-writer-2026-05 v2 (atomic):
      // All DB writes — refund-row insert, parent.refunded_amount bump, order status/meta update, audit —
      // happen in a single transaction inside RPC `record_refund_atomic`.
      // Idempotent by bePaid refund uid. Hard error if anything fails.
      let refundStatus: 'partial' | 'full' = 'partial';
      let newOrderStatus: 'paid' | 'refunded' = 'paid';
      let totalRefundedAfter = 0;
      let paidSumForOrder = 0;

      if (bepaidRefundSuccessful && successfulPayment) {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('record_refund_atomic', {
          p_order_id: order_id,
          p_parent_payment_id: successfulPayment.id,
          p_refund_amount: actualRefundAmount,
          p_refund_uid: bepaidRefundResult.transaction.uid,
          p_refund_reason: refund_reason,
          p_actor_user_id: adminUserId,
          p_target_user_id: order.user_id,
          p_bepaid_response: bepaidRefundResult?.transaction || null,
        });

        if (rpcError) {
          console.error('[refund] record_refund_atomic FAILED:', rpcError);
          // Write repair marker — bePaid refund happened but DB recording failed
          try {
            await supabase.from('audit_logs').insert({
              actor_user_id: adminUserId,
              target_user_id: order.user_id,
              actor_type: 'user',
              actor_label: 'subscription-admin-actions[refund]',
              action: 'admin.subscription.refund_db_recording_failed',
              meta: {
                order_id,
                order_number: order.order_number,
                refund_amount: actualRefundAmount,
                bepaid_refund_uid: bepaidRefundResult.transaction.uid,
                error: String(rpcError.message || rpcError),
                requires_manual_repair: true,
              },
            });
          } catch (_) { /* best effort marker */ }

          return new Response(JSON.stringify({
            success: false,
            error: 'bePaid refund прошёл, но запись в БД не удалась. Создан repair marker.',
            bepaid_refund_uid: bepaidRefundResult.transaction.uid,
            db_error: String(rpcError.message || rpcError),
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        refundStatus = (rpcResult?.refund_status as 'partial' | 'full') || 'partial';
        newOrderStatus = (rpcResult?.new_order_status as 'paid' | 'refunded') || 'paid';
        totalRefundedAfter = Number(rpcResult?.total_refunded_after) || 0;
        paidSumForOrder = Number(rpcResult?.paid_sum) || 0;

        if (rpcResult?.idempotent) {
          console.log(`[refund] idempotent — refund-row уже существовал uid=${bepaidRefundResult.transaction.uid}`);
        } else {
          console.log(`[refund] atomic recorded uid=${bepaidRefundResult.transaction.uid} status=${refundStatus} order=${newOrderStatus}`);
        }
      } else if (!bepaidRefundSuccessful) {
        // No bePaid payment to refund (skipped earlier path) — fall back to order-only update for legacy support
        const paymentsArr = (order.payments_v2 as any[]) || [];
        for (const p of paymentsArr) {
          const pStatus = (p?.status || '').toLowerCase();
          const pTxType = (p?.transaction_type || '').toLowerCase();
          const pMetaType = ((p?.meta as any)?.type || '').toLowerCase();
          const isRefundRow = pTxType.includes('refund') || pTxType.includes('возврат')
            || pMetaType === 'refund' || (Number(p?.amount) || 0) < 0;
          if (!isRefundRow && Number(p?.amount) > 0
            && (pStatus === 'succeeded' || pStatus === 'paid' || pStatus === 'refunded')) {
            paidSumForOrder += Number(p.amount) || 0;
          }
          totalRefundedAfter += Number(p?.refunded_amount) || 0;
          if (isRefundRow) totalRefundedAfter += Math.abs(Number(p?.amount) || 0);
        }
        totalRefundedAfter += actualRefundAmount;
        const isFullRefund = paidSumForOrder > 0 ? (totalRefundedAfter + 0.01 >= paidSumForOrder) : true;
        refundStatus = isFullRefund ? 'full' : 'partial';
        newOrderStatus = isFullRefund ? 'refunded' : 'paid';

        const { error: orderUpdateError } = await supabase
          .from('orders_v2')
          .update({
            status: newOrderStatus,
            meta: {
              ...(order.meta as object || {}),
              refund_amount: actualRefundAmount,
              refund_reason: refund_reason,
              refunded_at: new Date().toISOString(),
              refunded_by: adminUserId,
              bepaid_refund: null,
              bepaid_refund_error: bepaidRefundError,
              access_action: access_action || 'revoke',
              reduce_days: reduce_days || null,
              partial_refund_total: totalRefundedAfter,
              paid_sum: paidSumForOrder,
              refund_status: refundStatus,
              no_bepaid_payment: true,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', order_id);
        if (orderUpdateError) {
          console.error('[refund] order update FAILED (no-bepaid path):', orderUpdateError);
          return new Response(JSON.stringify({
            success: false,
            error: 'Не удалось обновить заказ',
            db_error: String(orderUpdateError.message),
          }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // Handle access action
      const effectiveAccessAction = access_action || 'revoke';
      
      // Find related subscription
      const { data: relatedSubscription } = await supabase
        .from('subscriptions_v2')
        .select('*, products_v2(telegram_club_id)')
        .eq('order_id', order_id)
        .maybeSingle();

      if (relatedSubscription) {
        const product = relatedSubscription.products_v2 as any;

        if (effectiveAccessAction === 'revoke') {
          // Revoke access immediately
          await supabase
            .from('subscriptions_v2')
            .update({
              status: 'canceled',
              access_end_at: new Date().toISOString(),
              cancel_at: new Date().toISOString(),
              canceled_at: new Date().toISOString(),
              cancel_reason: `Возврат: ${refund_reason}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', relatedSubscription.id);

          // Sub-patch B: Inline ledger BEFORE telegram call for parent lineage
          let refundRevokeSourceEventKey: string | null = null;
          let refundRevokeExecutionKey: string | null = null;
          try {
            refundRevokeSourceEventKey = `admin-refund-revoke:${relatedSubscription.id}:${order_id}`;
            const revokeCtx: RevokeContext = {
              userId: order.user_id,
              orderId: order_id,
              targetType: 'subscription_tier',
              targetKey: `${order.user_id}:${relatedSubscription.tariff_id || relatedSubscription.product_id || 'unknown'}`,
              targetRef: relatedSubscription.product_id || null,
              subscriptionId: relatedSubscription.id,
              reasonCode: 'admin_revoke',
              reconcileBasis: 'admin_refund_revoke',
              sourceEventType: 'admin',
              sourceEventKey: refundRevokeSourceEventKey,
              sourceSubjectType: 'admin_action',
              sourceSubjectRef: adminUserId,
            };
            const revokeResult = await executeRevoke(supabase, revokeCtx);
            refundRevokeExecutionKey = revokeResult.executionKey || null;
            console.log(`[refund+revoke] Ledger: revoked=${revokeResult.revoked}, id=${revokeResult.ledgerId}`);
          } catch (ledgerErr) {
            console.error('[refund+revoke] Ledger error (non-blocking):', ledgerErr);
          }

          // Sub-patch B: Revoke Telegram access with parent keys
          if (product?.telegram_club_id) {
            const revokeRes = await supabase.functions.invoke('telegram-revoke-access', {
              body: {
                user_id: order.user_id,
                club_id: product.telegram_club_id,
                is_manual: true,
                reason: 'refund',
                admin_id: adminUserId,
                parent_event_key: refundRevokeSourceEventKey || null,
                parent_execution_key: refundRevokeExecutionKey || null,
              },
            });
            console.log('[refund] telegram-revoke-access result:', JSON.stringify(revokeRes.data));
          } else {
            console.warn('[refund] No telegram_club_id on product — telegram revoke skipped');
          }

          console.log(`Access revoked for subscription ${relatedSubscription.id}`);
        } else if (effectiveAccessAction === 'reduce' && reduce_days > 0) {
          // Reduce access period
          const currentEnd = relatedSubscription.access_end_at 
            ? new Date(relatedSubscription.access_end_at) 
            : new Date();
          const newEndDate = new Date(currentEnd.getTime() - reduce_days * 24 * 60 * 60 * 1000);
          
          // Don't let access end in the past
          const finalEndDate = newEndDate < new Date() ? new Date() : newEndDate;

          await supabase
            .from('subscriptions_v2')
            .update({
              access_end_at: finalEndDate.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', relatedSubscription.id);

          console.log(`Access reduced by ${reduce_days} days for subscription ${relatedSubscription.id}`);
        } else if (effectiveAccessAction === 'keep_subscription') {
          // Keep subscription active with scheduled charges - do nothing
          console.log(`Subscription ${relatedSubscription.id} kept active, scheduled charges continue`);
        }
        // 'keep' action = do nothing with access
      }

      // Log the successful refund action
      await supabase.from('audit_logs').insert({
        actor_user_id: adminUserId,
        target_user_id: order.user_id,
        action: 'admin.subscription.refund',
        meta: {
          order_id,
          order_number: order.order_number,
          refund_amount: actualRefundAmount,
          refund_reason: refund_reason,
          currency: order.currency,
          original_amount: order.final_price,
          access_action: effectiveAccessAction,
          reduce_days: reduce_days || null,
          bepaid_success: bepaidRefundSuccessful,
          bepaid_refund_uid: bepaidRefundResult?.transaction?.uid || null,
          bepaid_error: bepaidRefundError,
          had_bepaid_payment: hasBepaidPayment,
        },
      });

      console.log(`Refund processed for order ${order_id}: ${actualRefundAmount} ${order.currency}`);

      return new Response(JSON.stringify({ 
        success: true, 
        refund_amount: actualRefundAmount,
        order_number: order.order_number,
        bepaid_success: bepaidRefundSuccessful,
        bepaid_error: bepaidRefundError,
        access_action: effectiveAccessAction,
        refund_payment_uid: bepaidRefundResult?.transaction?.uid || null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For other actions, subscription_id is required
    if (!subscription_id) {
      return new Response(JSON.stringify({ success: false, error: 'subscription_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get subscription with related product and tariff
    // Note: orders_v2 can have multiple orders per subscription, so we fetch it separately
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select('*, products_v2(telegram_club_id, name), tariffs(getcourse_offer_id, getcourse_offer_code, name)')
      .eq('id', subscription_id)
      .maybeSingle();

    if (subError || !subscription) {
      console.log('Subscription lookup error:', subError?.message || 'not found', 'subscription_id:', subscription_id);

      // Idempotency: deleting an already-deleted subscription should not break UI flows
      if (action === 'delete') {
        return new Response(
          JSON.stringify({ success: true, already_deleted: true, subscription_id }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response(JSON.stringify({ success: false, error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch order data - use subscription.order_id (direct FK) or fallback to user_id + product_id
    let orderData = null;
    
    if (subscription.order_id) {
      // Primary: use the direct FK link
      const { data } = await supabase
        .from('orders_v2')
        .select('order_number, customer_email, final_price, meta, user_id')
        .eq('id', subscription.order_id)
        .maybeSingle();
      orderData = data;
    }
    
    // Fallback: if no order_id, search by user_id + product_id
    if (!orderData && subscription.user_id && subscription.product_id) {
      const { data: ordersData, count } = await supabase
        .from('orders_v2')
        .select('order_number, customer_email, final_price, meta, user_id', { count: 'exact' })
        .eq('user_id', subscription.user_id)
        .eq('product_id', subscription.product_id)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(1);
      
      orderData = ordersData?.[0] || null;
      
      if (count && count > 1) {
        console.warn(`[subscription-admin-actions] Multiple orders (${count}) found for subscription ${subscription_id}, using latest`);
      }
    }

    // Attach order data to subscription object for backward compatibility
    (subscription as any).orders_v2 = orderData;

    // Get email from profiles - search by both profile.id and user_id since user_id might be profile.id
    const { data: profileData } = await supabase
      .from('profiles')
      .select('email')
      .or(`id.eq.${subscription.user_id},user_id.eq.${subscription.user_id}`)
      .maybeSingle();

    // Get email from profiles or order (orderData already attached above)
    const customerEmail = orderData?.customer_email || profileData?.email;

    let result: Record<string, any> = { success: true };

    // Phase 1: Pre-state snapshot for revoke branches (before any DB update)
    const beforeSnapshot = {
      status: subscription.status,
      canceled_at: subscription.canceled_at,
      access_end_at: subscription.access_end_at,
      cancel_at: subscription.cancel_at,
    };
    let branchAuditId: string | null = null;
    let pendingPhysicalDelete = false;

    switch (action) {
      case 'cancel': {
        const cancelAt = subscription.access_end_at || new Date().toISOString();
        
        await supabase
          .from('subscriptions_v2')
          .update({
            cancel_at: cancelAt,
            canceled_at: new Date().toISOString(),
            next_charge_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // Branch-specific audit for ledger discriminator
        const { data: cancelAudit } = await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: subscription.user_id,
          action: 'admin.subscription.cancel.ledger',
          actor_type: 'admin',
          meta: {
            subscription_id,
            before_status: beforeSnapshot.status,
            before_canceled_at: beforeSnapshot.canceled_at,
          },
        }).select('id').single();
        branchAuditId = cancelAudit?.id || null;

        // Sub-patch B: Inline ledger for cancel (no downstream call needed)
        try {
          const cancelDiscriminator = branchAuditId || subscription_id;
          const cancelAlreadyCanceled = beforeSnapshot.status === 'canceled' || beforeSnapshot.status === 'expired';
          const cancelSourceEventKey = `admin-cancel:${subscription_id}:${cancelDiscriminator}`;

          if (cancelAlreadyCanceled) {
            await writeLedgerEntry(supabase, {
              source_event_type: 'admin',
              source_event_key: cancelSourceEventKey,
              source_subject_type: 'admin_action',
              source_subject_ref: adminUserId,
              source_subscription_id: subscription_id,
              action_type: 'skip',
              reason_code: 'admin_cancel' as any,
              target_type: 'subscription_tier',
              target_key: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
              target_ref: subscription.product_id || null,
              user_id: subscription.user_id,
              order_id: subscription.order_id || null,
              status: 'skipped',
              result: {
                skip_reason: 'already_canceled',
                branch_decision_source: 'before_after_projection_diff',
                audit_discriminator_source: 'branch_audit_id',
                before_status: beforeSnapshot.status,
                before_canceled_at: beforeSnapshot.canceled_at,
                reconcile_basis: 'admin_cancel',
              },
            });
            console.log(`[subscription-admin-actions] Ledger cancel: skipped (already_canceled)`);
          } else {
            const cancelRevokeResult = await executeRevoke(supabase, {
              userId: subscription.user_id,
              orderId: subscription.order_id || null,
              targetType: 'subscription_tier',
              targetKey: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
              targetRef: subscription.product_id || null,
              subscriptionId: subscription_id,
              reasonCode: 'admin_cancel' as any,
              reconcileBasis: 'admin_cancel',
              sourceEventType: 'admin',
              sourceEventKey: cancelSourceEventKey,
              sourceSubjectType: 'admin_action',
              sourceSubjectRef: adminUserId,
              metadata: {
                branch_decision_source: 'before_after_projection_diff',
                audit_discriminator_source: 'branch_audit_id',
                before_status: beforeSnapshot.status,
                before_canceled_at: beforeSnapshot.canceled_at,
              },
            });
            console.log(`[subscription-admin-actions] Ledger cancel: revoked=${cancelRevokeResult.revoked}, id=${cancelRevokeResult.ledgerId}`);
          }
        } catch (ledgerErr) {
          console.error('[subscription-admin-actions] Ledger error for cancel (non-blocking):', ledgerErr);
        }

        // Send Telegram notification about cancellation (access_ending)
        const endDate = new Date(cancelAt).toLocaleDateString('ru-RU');
        const product = subscription.products_v2 as any;
        const clubName = product?.name || 'клубе';
        await sendTelegramNotification(
          supabase,
          subscription.user_id,
          'custom',
          `⏰ Подписка отменена\n\nАвтопродление отключено. Ваш доступ в ${clubName} сохраняется до ${endDate}.\n\nПосле этой даты доступ будет закрыт автоматически.`
        );

        result.cancel_at = cancelAt;
        break;
      }

      case 'resume': {
        await supabase
          .from('subscriptions_v2')
          .update({
            cancel_at: null,
            canceled_at: null,
            status: subscription.is_trial ? 'trial' : 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);
        break;
      }

      case 'pause': {
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'paused',
            next_charge_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);
        break;
      }

      case 'extend': {
        const daysToAdd = days || 30;
        const currentEnd = subscription.access_end_at 
          ? new Date(subscription.access_end_at) 
          : new Date();
        const newEndDate = new Date(currentEnd.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        const newEndDateStr = newEndDate.toLocaleDateString('ru-RU');
        
        await supabase
          .from('subscriptions_v2')
          .update({
            access_end_at: newEndDate.toISOString(),
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // Extend Telegram access if linked
        const product = subscription.products_v2 as any;
        if (product?.telegram_club_id) {
          await supabase.functions.invoke('telegram-grant-access', {
            body: {
              user_id: subscription.user_id,
              club_id: product.telegram_club_id,
              source_id: subscription_id,
              source: 'subscription-admin-actions:extend',
              duration_days: daysToAdd,
            },
          });
        }

        // Update in GetCourse with gc_deal_number for update
        const tariffForExtend = subscription.tariffs as any;
        const gcOfferIdExtend = tariffForExtend?.getcourse_offer_id || tariffForExtend?.getcourse_offer_code;
        const orderForExtend = subscription.orders_v2 as any;
        // Use gc_deal_number (our generated number) for updates, fallback to gc_order_id
        const gcDealNumberExtend = orderForExtend?.meta?.gc_deal_number || orderForExtend?.meta?.gc_order_id;
        if (gcOfferIdExtend && orderForExtend?.customer_email) {
          const gcResult = await updateGetCourseOrder(
            orderForExtend.customer_email,
            gcOfferIdExtend,
            orderForExtend.order_number || subscription_id,
            newEndDateStr,
            orderForExtend.final_price || 0,
            gcDealNumberExtend // Pass deal_number to update existing deal
          );
          console.log('GetCourse extend/update result:', gcResult);
          result.getcourse_update = gcResult;
        }

        // Send Telegram notification about extension
        const clubName = product?.name || 'клубе';
        await sendTelegramNotification(
          supabase,
          subscription.user_id,
          'custom',
          `✅ Доступ продлён!\n\nВаша подписка в ${clubName} продлена на ${daysToAdd} дней.\nНовая дата окончания: ${newEndDateStr}\n\nСпасибо, что вы с нами 💙`
        );

        result.new_end_date = newEndDate.toISOString();

        // ============= v23.1.10: Entitlement sync after extend =============
        if (subscription.product_id) {
          try {
            const { data: prdSync } = await supabase.from('products_v2').select('code').eq('id', subscription.product_id).maybeSingle();
            if (prdSync?.code) {
              const { data: profileSync } = await supabase.from('profiles').select('id').eq('user_id', subscription.user_id).maybeSingle();
              const sr = await syncEntitlement({
                supabase, user_id: subscription.user_id, profile_id: profileSync?.id || null,
                product_id: subscription.product_id, product_code: prdSync.code,
                access_end_at: newEndDate.toISOString(), source: 'admin_extend',
                subscription_id, actor_label: 'subscription-admin-actions', mode_filter: 'subscription_based',
              });
              console.log(`[subscription-admin-actions] Entitlement sync (extend): ${sr.action}`);
            }
          } catch (e) { console.error('[subscription-admin-actions] Entitlement sync error (extend):', e); }
        }

        break;
      }

      case 'set_end_date': {
        if (!new_end_date) {
          return new Response(JSON.stringify({ success: false, error: 'new_end_date required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        await supabase
          .from('subscriptions_v2')
          .update({
            access_end_at: new_end_date,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        result.new_end_date = new_end_date;

        // ============= v23.1.10: Entitlement sync after set_end_date =============
        if (subscription.product_id) {
          try {
            const { data: prdSync } = await supabase.from('products_v2').select('code').eq('id', subscription.product_id).maybeSingle();
            if (prdSync?.code) {
              const { data: profileSync } = await supabase.from('profiles').select('id').eq('user_id', subscription.user_id).maybeSingle();
              const sr = await syncEntitlement({
                supabase, user_id: subscription.user_id, profile_id: profileSync?.id || null,
                product_id: subscription.product_id, product_code: prdSync.code,
                access_end_at: new_end_date, source: 'admin_action',
                subscription_id, actor_label: 'subscription-admin-actions', mode_filter: 'subscription_based',
              });
              console.log(`[subscription-admin-actions] Entitlement sync (set_end_date): ${sr.action}`);
            }
          } catch (e) { console.error('[subscription-admin-actions] Entitlement sync error (set_end_date):', e); }
        }

        break;
      }

      case 'grant_access': {
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'active',
            cancel_at: null,
            canceled_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // Grant Telegram access
        const product = subscription.products_v2 as any;
        if (product?.telegram_club_id && subscription.access_end_at) {
          const daysRemaining = Math.ceil(
            (new Date(subscription.access_end_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
          );
          if (daysRemaining > 0) {
            await supabase.functions.invoke('telegram-grant-access', {
              body: {
                user_id: subscription.user_id,
                club_id: product.telegram_club_id,
                source_id: subscription_id,
                source: 'subscription-admin-actions:grant_access',
                duration_days: daysRemaining,
              },
            });
          }
        }

        // ============= v23.1.10: Entitlement sync after grant_access =============
        if (subscription.product_id) {
          try {
            const { data: prdSync } = await supabase.from('products_v2').select('code').eq('id', subscription.product_id).maybeSingle();
            if (prdSync?.code) {
              const { data: profileSync } = await supabase.from('profiles').select('id').eq('user_id', subscription.user_id).maybeSingle();
              const sr = await syncEntitlement({
                supabase, user_id: subscription.user_id, profile_id: profileSync?.id || null,
                product_id: subscription.product_id, product_code: prdSync.code,
                access_end_at: subscription.access_end_at, source: 'admin_grant',
                subscription_id, actor_label: 'subscription-admin-actions', mode_filter: 'subscription_based',
              });
              console.log(`[subscription-admin-actions] Entitlement sync (grant_access): ${sr.action}`);
            }
          } catch (e) { console.error('[subscription-admin-actions] Entitlement sync error (grant_access):', e); }
        }

        break;
      }

      case 'revoke_access': {
        // ============= v23.1.10: PRE-REVOKE GUARD =============
        // Check if there's another active access source before revoking entitlement
        let skipEntitlementRevoke = false;
        let preRevokeCheckResult: any = null;
        if (subscription.product_id) {
          const { data: productForRevoke } = await supabase
            .from('products_v2')
            .select('code')
            .eq('id', subscription.product_id)
            .maybeSingle();

          if (productForRevoke?.code) {
            preRevokeCheckResult = await hasOtherActiveAccessSource(
              supabase,
              subscription.user_id,
              productForRevoke.code,
              subscription_id,
            );
            if (preRevokeCheckResult.has_other) {
              skipEntitlementRevoke = true;
              console.log(`[subscription-admin-actions] Pre-revoke guard: skipping entitlement revoke for ${productForRevoke.code}, other sources: ${preRevokeCheckResult.sources.join(', ')}`);
              
              await supabase.from('audit_logs').insert({
                actor_user_id: adminUserId,
                target_user_id: subscription.user_id,
                action: 'admin.subscription.revoke_entitlement_skipped',
                actor_type: 'admin',
                meta: {
                  subscription_id,
                  product_code: productForRevoke.code,
                  other_sources: preRevokeCheckResult.sources,
                  reason: 'has_other_active_access_source',
                },
              });
            }
          }
        }
        // ============= END PRE-REVOKE GUARD =============

        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'canceled',
            access_end_at: new Date().toISOString(),
            cancel_at: new Date().toISOString(),
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // Branch-specific audit for ledger discriminator
        const { data: revokeAudit } = await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: subscription.user_id,
          action: 'admin.subscription.revoke_access.ledger',
          actor_type: 'admin',
          meta: {
            subscription_id,
            before_status: beforeSnapshot.status,
            before_canceled_at: beforeSnapshot.canceled_at,
            before_access_end_at: beforeSnapshot.access_end_at,
          },
        }).select('id').single();
        branchAuditId = revokeAudit?.id || null;

        // Sub-patch B: Inline ledger BEFORE telegram call for parent lineage
        let revokeAccessSourceEventKey: string | null = null;
        let revokeAccessExecutionKey: string | null = null;
        try {
          const revokeDiscriminator = branchAuditId || subscription_id;
          revokeAccessSourceEventKey = `admin-revoke:${subscription_id}:${revokeDiscriminator}`;
          const revokeAlreadyCanceled = beforeSnapshot.status === 'canceled' || beforeSnapshot.status === 'expired';

          if (revokeAlreadyCanceled) {
            const skipResult = await writeLedgerEntry(supabase, {
              source_event_type: 'admin',
              source_event_key: revokeAccessSourceEventKey,
              source_subject_type: 'admin_action',
              source_subject_ref: adminUserId,
              source_subscription_id: subscription_id,
              action_type: 'skip',
              reason_code: 'admin_revoke' as any,
              target_type: 'subscription_tier',
              target_key: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
              target_ref: subscription.product_id || null,
              user_id: subscription.user_id,
              order_id: subscription.order_id || null,
              status: 'skipped',
              result: { skip_reason: 'already_canceled', branch_decision_source: 'before_after_projection_diff', audit_discriminator_source: 'branch_audit_id', before_status: beforeSnapshot.status, reconcile_basis: 'admin_revoke_access' },
            });
            revokeAccessExecutionKey = skipResult.execution_key;
            console.log(`[subscription-admin-actions] Ledger revoke_access: skipped (already_canceled)`);
          } else {
            const rr = await executeRevoke(supabase, {
              userId: subscription.user_id, orderId: subscription.order_id || null,
              targetType: 'subscription_tier', targetKey: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
              targetRef: subscription.product_id || null, subscriptionId: subscription_id,
              reasonCode: 'admin_revoke' as any, reconcileBasis: 'admin_revoke_access',
              sourceEventType: 'admin', sourceEventKey: revokeAccessSourceEventKey,
              sourceSubjectType: 'admin_action', sourceSubjectRef: adminUserId,
              metadata: { branch_decision_source: 'before_after_projection_diff', audit_discriminator_source: 'branch_audit_id', before_status: beforeSnapshot.status },
            });
            revokeAccessExecutionKey = rr.executionKey || null;
            console.log(`[subscription-admin-actions] Ledger revoke_access: revoked=${rr.revoked}, id=${rr.ledgerId}`);
          }
        } catch (ledgerErr) {
          console.error('[subscription-admin-actions] Ledger error for revoke_access (non-blocking):', ledgerErr);
        }

        // ============= v23.1.10: Conditional entitlement revoke =============
        if (!skipEntitlementRevoke && subscription.product_id) {
          const productCodeForRevoke = (subscription.products_v2 as any)?.code;
          if (productCodeForRevoke) {
            const { error: revokeEntErr } = await supabase
              .from('entitlements')
              .update({ status: 'expired', updated_at: new Date().toISOString(), meta: { ...({} as any), revoked_by: 'subscription-admin-actions', revoke_source: 'admin_revoke_access', revoked_at: new Date().toISOString() } })
              .eq('user_id', subscription.user_id)
              .eq('product_code', productCodeForRevoke);
            if (revokeEntErr) {
              console.error('[subscription-admin-actions] Entitlement revoke error:', revokeEntErr);
            } else {
              console.log(`[subscription-admin-actions] Entitlement revoked for ${productCodeForRevoke}`);
            }
          }
        } else if (skipEntitlementRevoke) {
          console.log(`[subscription-admin-actions] Entitlement revoke SKIPPED due to pre-revoke guard`);
        }
        // ============= END v23.1.10 =============

        // Revoke Telegram access with club_id + parent keys
        const productForRevoke = subscription.products_v2 as any;
        if (productForRevoke?.telegram_club_id) {
          const revokeResult = await supabase.functions.invoke('telegram-revoke-access', {
            body: {
              user_id: subscription.user_id,
              club_id: productForRevoke.telegram_club_id,
              is_manual: true,
              reason: 'subscription_revoked',
              admin_id: adminUserId,
              parent_event_key: revokeAccessSourceEventKey || null,
              parent_execution_key: revokeAccessExecutionKey || null,
            },
          });
          console.log('[revoke_access] Telegram revoke result:', JSON.stringify(revokeResult.data));
        }

        // Cancel in GetCourse with gc_deal_number for update
        const tariffForRevoke = subscription.tariffs as any;
        const orderForRevoke = subscription.orders_v2 as any;
        // Get offer_id from order meta first, then fallback to tariff
        const orderMeta = orderForRevoke?.meta || {};
        let gcOfferIdRevoke = tariffForRevoke?.getcourse_offer_id || tariffForRevoke?.getcourse_offer_code;
        
        // If offer_id in meta, get getcourse_offer_id from tariff_offers
        if (orderMeta.offer_id) {
          const { data: offerData } = await supabase
            .from('tariff_offers')
            .select('getcourse_offer_id')
            .eq('id', orderMeta.offer_id)
            .single();
          if (offerData?.getcourse_offer_id) {
            gcOfferIdRevoke = offerData.getcourse_offer_id;
          }
        }
        
        // Use gc_deal_number (our generated number) for updates, fallback to gc_order_id
        const gcDealNumberRevoke = orderMeta.gc_deal_number || orderMeta.gc_order_id;
        const emailForRevoke = orderForRevoke?.customer_email || customerEmail;
        
        if (gcOfferIdRevoke && emailForRevoke) {
          const gcResult = await cancelGetCourseOrder(
            emailForRevoke,
            gcOfferIdRevoke,
            orderForRevoke?.order_number || subscription_id,
            'Доступ отозван администратором',
            orderForRevoke?.final_price || 0,
            gcDealNumberRevoke // Pass deal_number to update existing deal
          );
          console.log('GetCourse cancel result:', gcResult);
          result.getcourse_cancel = gcResult;
        }

        // Send Telegram notification about revocation
        await sendTelegramNotification(supabase, subscription.user_id, 'access_revoked');

        break;
      }

      case 'delete': {
        // PATCH: порядок операций — сначала UPDATE статуса, потом audit+ledger, потом revoke, потом DELETE.

        // 1. Обновляем статус до revoke (чтобы guard в telegram-revoke-access не видел active)
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'canceled',
            access_end_at: new Date().toISOString(),
            cancel_at: new Date().toISOString(),
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // 2. Branch-specific audit for ledger discriminator (BEFORE physical delete)
        const { data: deleteAudit } = await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: subscription.user_id,
          action: 'admin.subscription.delete.ledger',
          actor_type: 'admin',
          meta: {
            subscription_id,
            before_status: beforeSnapshot.status,
            before_canceled_at: beforeSnapshot.canceled_at,
            before_access_end_at: beforeSnapshot.access_end_at,
            tariff_id: subscription.tariff_id,
            product_id: subscription.product_id,
          },
        }).select('id').single();
        branchAuditId = deleteAudit?.id || null;

        // Sub-patch B: Inline ledger BEFORE telegram call for parent lineage
        let deleteSourceEventKey: string | null = null;
        let deleteExecutionKey: string | null = null;
        try {
          const deleteDiscriminator = branchAuditId || subscription_id;
          deleteSourceEventKey = `admin-delete:${subscription_id}:${deleteDiscriminator}`;
          const deleteAlreadyCanceled = beforeSnapshot.status === 'canceled' || beforeSnapshot.status === 'expired';

          if (deleteAlreadyCanceled) {
            const skipResult = await writeLedgerEntry(supabase, {
              source_event_type: 'admin', source_event_key: deleteSourceEventKey,
              source_subject_type: 'admin_action', source_subject_ref: adminUserId,
              source_subscription_id: subscription_id, action_type: 'skip',
              reason_code: 'admin_revoke' as any, target_type: 'subscription_tier',
              target_key: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
              target_ref: subscription.product_id || null, user_id: subscription.user_id,
              order_id: subscription.order_id || null, status: 'skipped',
              result: { skip_reason: 'already_canceled', branch_decision_source: 'before_after_projection_diff', audit_discriminator_source: 'branch_audit_id', before_status: beforeSnapshot.status, reconcile_basis: 'admin_delete' },
            });
            deleteExecutionKey = skipResult.execution_key;
            console.log(`[subscription-admin-actions] Ledger delete: skipped (already_canceled)`);
          } else {
            const dr = await executeRevoke(supabase, {
              userId: subscription.user_id, orderId: subscription.order_id || null,
              targetType: 'subscription_tier', targetKey: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
              targetRef: subscription.product_id || null, subscriptionId: subscription_id,
              reasonCode: 'admin_revoke' as any, reconcileBasis: 'admin_delete',
              sourceEventType: 'admin', sourceEventKey: deleteSourceEventKey,
              sourceSubjectType: 'admin_action', sourceSubjectRef: adminUserId,
              metadata: { branch_decision_source: 'before_after_projection_diff', audit_discriminator_source: 'branch_audit_id', before_status: beforeSnapshot.status },
            });
            deleteExecutionKey = dr.executionKey || null;
            console.log(`[subscription-admin-actions] Ledger delete: revoked=${dr.revoked}, id=${dr.ledgerId}`);
          }
        } catch (ledgerErr) {
          console.error('[subscription-admin-actions] Ledger error for delete (non-blocking):', ledgerErr);
        }

        // 3. Send Telegram notification
        await sendTelegramNotification(supabase, subscription.user_id, 'access_revoked');

        // 4. Revoke Telegram access with parent keys
        const productForDelete = subscription.products_v2 as any;
        if (productForDelete?.telegram_club_id) {
          const revokeResult = await supabase.functions.invoke('telegram-revoke-access', {
            body: {
              user_id: subscription.user_id,
              club_id: productForDelete.telegram_club_id,
              is_manual: true,
              reason: 'subscription_deleted',
              admin_id: adminUserId,
              parent_event_key: deleteSourceEventKey || null,
              parent_execution_key: deleteExecutionKey || null,
            },
          });
          console.log('[delete] Telegram revoke result:', JSON.stringify(revokeResult.data));
        } else {
          console.warn('[delete] No telegram_club_id on product — telegram revoke skipped');
        }

        // 5. Cancel in GetCourse
        const tariffForDelete = subscription.tariffs as any;
        const gcOfferIdDelete = tariffForDelete?.getcourse_offer_id || tariffForDelete?.getcourse_offer_code;
        const orderForDelete = subscription.orders_v2 as any;
        const gcDealNumberDelete = orderForDelete?.meta?.gc_deal_number || orderForDelete?.meta?.gc_order_id;
        if (gcOfferIdDelete && orderForDelete?.customer_email) {
          const gcResult = await cancelGetCourseOrder(
            orderForDelete.customer_email,
            gcOfferIdDelete,
            orderForDelete.order_number || subscription_id,
            'Подписка удалена',
            orderForDelete.final_price || 0,
            gcDealNumberDelete
          );
          console.log('GetCourse cancel result:', gcResult);
          result.getcourse_cancel = gcResult;
        }

        // 6. Physical delete is DEFERRED until after ledger write
        pendingPhysicalDelete = true;

        result.deleted = true;
        break;
      }

      case 'toggle_auto_renew': {
        const { auto_renew: newAutoRenew, reason } = body;

        if (typeof newAutoRenew !== 'boolean') {
          return new Response(JSON.stringify({ success: false, error: 'auto_renew must be boolean' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const existingMeta = subscription.meta as Record<string, unknown> || {};
        const updateData: Record<string, unknown> = {
          auto_renew: newAutoRenew,
          meta: {
            ...existingMeta,
            auto_renew_changed_by: adminUserId,
            auto_renew_changed_at: new Date().toISOString(),
            auto_renew_change_reason: reason || (newAutoRenew ? 'Включено администратором' : 'Отключено администратором'),
          },
          updated_at: new Date().toISOString(),
        };

        // If enabling auto-renew, try to link payment method
        if (newAutoRenew) {
          const { data: paymentMethod } = await supabase
            .from('payment_methods')
            .select('id, provider_token')
            .eq('user_id', subscription.user_id)
            .eq('status', 'active')
            .order('is_default', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (paymentMethod) {
            updateData.payment_method_id = paymentMethod.id;
            updateData.payment_token = paymentMethod.provider_token;
          }
          result.payment_method_linked = !!paymentMethod;
        } else {
          // If disabling, clear payment method link
          updateData.payment_method_id = null;
          updateData.payment_token = null;
          result.payment_method_linked = false;
        }

        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update(updateData)
          .eq('id', subscription_id);

        if (updateError) {
          console.error('Error toggling auto-renew:', updateError);
          return new Response(JSON.stringify({ success: false, error: 'Failed to toggle auto-renew' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Log the specific action
        await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: subscription.user_id,
          action: newAutoRenew ? 'admin.subscription.auto_renew_enabled' : 'admin.subscription.auto_renew_disabled',
          meta: {
            subscription_id,
            order_id: subscription.order_id,
            reason: reason || null,
            has_payment_method: result.payment_method_linked,
          },
        });

        result.auto_renew = newAutoRenew;
        console.log(`Admin toggled auto-renew to ${newAutoRenew} for subscription ${subscription_id}`);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Log the admin action (BEFORE ledger write to get auditLogId)
    const { data: auditRow } = await supabase.from('audit_logs').insert({
      actor_user_id: adminUserId,
      target_user_id: subscription.user_id,
      action: `admin.subscription.${action}`,
      meta: {
        subscription_id,
        action,
        days,
        new_end_date,
        ...result,
      },
    }).select('id').single();

    const auditLogId = auditRow?.id || subscription_id;

    // Phase 1 Ledger: post-switch block REMOVED (v22.6 Sub-patch B)
    // All revoke branches (cancel, revoke_access, delete, refund+revoke)
    // now have inline ledger writes within their respective case blocks.
    // See: cancel (~line 710), revoke_access (~line 943), delete (~line 1078), refund+revoke (~line 483).

    // Deferred physical delete: AFTER audit + ledger writes to preserve traceability
    if (pendingPhysicalDelete) {
      await supabase
        .from('subscriptions_v2')
        .delete()
        .eq('id', subscription_id);
      console.log(`[subscription-admin-actions] Physical delete completed for ${subscription_id}`);
    }

    console.log(`Admin action ${action} completed for subscription ${subscription_id}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Admin subscription action error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
