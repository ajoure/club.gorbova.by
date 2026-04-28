import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { getSubscriptionToken, isSkip } from '../_shared/token-resolver.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Translate bePaid error messages to Russian
function translatePaymentError(error: string): string {
  const errorMap: Record<string, string> = {
    'Insufficient funds': 'Недостаточно средств на карте',
    'insufficient_funds': 'Недостаточно средств на карте',
    'Card declined': 'Карта отклонена банком',
    'card_declined': 'Карта отклонена банком',
    'Expired card': 'Срок действия карты истёк',
    'expired_card': 'Срок действия карты истёк',
    'Invalid card': 'Неверные данные карты',
    'invalid_card': 'Неверные данные карты',
    'Do not honor': 'Операция отклонена банком',
    'do_not_honor': 'Операция отклонена банком',
    'Lost card': 'Карта заблокирована (утеряна)',
    'lost_card': 'Карта заблокирована (утеряна)',
    'Stolen card': 'Карта заблокирована (украдена)',
    'stolen_card': 'Карта заблокирована (украдена)',
    'Card restricted': 'Ограничения на карте',
    'card_restricted': 'Ограничения на карте',
    'Transaction not permitted': 'Операция не разрешена для данной карты',
    'transaction_not_permitted': 'Операция не разрешена для данной карты',
    'Invalid amount': 'Неверная сумма',
    'invalid_amount': 'Неверная сумма',
    'Authentication failed': 'Ошибка аутентификации 3D Secure',
    'authentication_failed': 'Ошибка аутентификации 3D Secure',
    '3-D Secure authentication failed': 'Ошибка подтверждения 3D Secure',
    'Payment failed': 'Платёж не прошёл',
    'payment_failed': 'Платёж не прошёл',
    'Token expired': 'Сохранённая карта устарела',
    'token_expired': 'Сохранённая карта устарела',
    'Invalid token': 'Ошибка привязанной карты',
    'invalid_token': 'Ошибка привязанной карты',
  };

  if (errorMap[error]) return errorMap[error];
  const lowerError = error.toLowerCase();
  for (const [key, value] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) return value;
  }
  return `Ошибка платежа: ${error}`;
}

// Send Telegram notification about payment failure
async function sendPaymentFailureNotification(
  supabase: any,
  userId: string,
  productName: string,
  amount: number,
  currency: string,
  errorMessage: string,
  paymentNumber?: number,
  totalPayments?: number
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_link_status, full_name')
      .eq('user_id', userId)
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== 'active') {
      return;
    }

    const { data: linkBot } = await supabase
      .from('telegram_bots')
      .select('token')
      .eq('is_link_bot', true)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!linkBot?.token) return;

    const userName = profile.full_name || 'Клиент';
    const russianError = translatePaymentError(errorMessage);
    const installmentInfo = paymentNumber && totalPayments 
      ? `\n📊 *Платёж:* ${paymentNumber} из ${totalPayments}` 
      : '';
    
    const message = `❌ *Платёж не прошёл*

${userName}, к сожалению, не удалось провести оплату.

📦 *Продукт:* ${productName}
💳 *Сумма:* ${amount} ${currency}${installmentInfo}
⚠️ *Причина:* ${russianError}

*Что можно сделать:*
• Проверьте баланс карты
• Убедитесь, что карта не заблокирована
• Попробуйте оплатить другой картой

🔗 [Попробовать снова](https://club.gorbova.by/purchases)`;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    console.log(`Sent payment failure notification to user ${userId} via Telegram`);
  } catch (err) {
    console.error('Failed to send payment failure notification:', err);
  }
}

// Best-effort вызов installment-notifications с обязательным аудитом.
// Никогда не блокирует основной flow списания — даже при HTTP-ошибке.
async function notifyWithAudit(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  action: 'success' | 'failed' | 'completion',
  installmentId: string,
  context: Record<string, any>,
): Promise<void> {
  const auditAction =
    action === 'success' ? 'installment.notification_success_requested' :
    action === 'failed' ? 'installment.notification_failed_requested' :
    'installment.notification_completion_requested';

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/installment-notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ action, installment_id: installmentId }),
    });

    const ok = resp.ok;
    const respText = ok ? null : await resp.text().catch(() => null);

    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_label: 'installment-charge-cron',
      action: ok ? auditAction : 'installment.notification_request_failed',
      meta: {
        installment_id: installmentId,
        notification_action: action,
        http_status: resp.status,
        http_ok: ok,
        response_excerpt: respText ? String(respText).slice(0, 500) : null,
        ...context,
      },
    });
  } catch (notifErr) {
    console.error(`Notification ${action} request failed:`, notifErr);
    try {
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_label: 'installment-charge-cron',
        action: 'installment.notification_request_failed',
        meta: {
          installment_id: installmentId,
          notification_action: action,
          error: notifErr instanceof Error ? notifErr.message : String(notifErr),
          ...context,
        },
      });
    } catch (_) { /* ignore audit failure */ }
  }
}

// This function should be called by a cron job daily
// It processes pending installment payments that are due

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting installment charge cron job...');

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error('bePaid credentials missing:', credsResult.error);
      return new Response(JSON.stringify({ error: 'BEPAID_CREDS_MISSING: ' + credsResult.error }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bepaidCreds = credsResult;
    const shopId = bepaidCreds.shop_id;
    const testMode = bepaidCreds.test_mode;
    const bepaidAuth = createBepaidAuthHeader(bepaidCreds); // "Basic <base64>"

    // Find pending installments that are due with exponential backoff
    // Explicitly exclude closed statuses (cancelled, forgiven) for safety
    const now = new Date();
    console.log('Excluding closed installments with statuses: cancelled, forgiven');
    
    const { data: dueInstallments, error: fetchError } = await supabase
      .from('installment_payments')
      .select(`
        *,
        subscriptions_v2 (
          id, user_id, payment_method_id, payment_token, status,
          products_v2 ( name, currency )
        )
      `)
      .eq('status', 'pending')
      .not('status', 'in', '("cancelled","forgiven")')
      .lte('due_date', now.toISOString())
      .lt('charge_attempts', 5) // Max 5 attempts with backoff
      .order('due_date', { ascending: true })
      .limit(50); // Process in batches
    
    // Filter by exponential backoff: wait 1h, 4h, 24h, 72h before retries
    const backoffHours = [0, 1, 4, 24, 72];
    const filteredInstallments = (dueInstallments || []).filter(inst => {
      const attempts = inst.charge_attempts || 0;
      if (attempts === 0) return true;
      
      const lastAttempt = inst.last_attempt_at ? new Date(inst.last_attempt_at) : null;
      if (!lastAttempt) return true;
      
      const waitHours = backoffHours[Math.min(attempts, backoffHours.length - 1)];
      const nextAttemptTime = new Date(lastAttempt.getTime() + waitHours * 60 * 60 * 1000);
      return now >= nextAttemptTime;
    });

    if (fetchError) {
      console.error('Error fetching due installments:', fetchError);
      return new Response(JSON.stringify({ success: false, error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${filteredInstallments.length} due installments to process (after backoff filter)`);

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const installment of filteredInstallments) {
      results.processed++;
      const subscription = installment.subscriptions_v2;

      // Stage 3: пропуск завершённых/отменённых подписок (canceled/expired/superseded)
      if (!subscription?.id) {
        console.log(`Пропуск платежа ${installment.id}: подписка не привязана`);
        results.skipped++;
        continue;
      }

      const subStatus = subscription.status;
      if (subStatus === 'canceled' || subStatus === 'expired' || subStatus === 'superseded') {
        console.log(`Пропуск платежа ${installment.id}: подписка в статусе ${subStatus}`);
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'installment-charge-cron',
          action: 'installment.skipped_subscription_inactive',
          meta: { installment_id: installment.id, subscription_id: subscription.id, subscription_status: subStatus },
        });
        results.skipped++;
        continue;
      }

      // Stage 3: guard — payment_number не должен превышать total_payments
      if (installment.payment_number > installment.total_payments) {
        console.error(`Пропуск платежа ${installment.id}: payment_number ${installment.payment_number} > total_payments ${installment.total_payments}`);
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'installment-charge-cron',
          action: 'installment.guard_payment_number_overflow',
          meta: { installment_id: installment.id, payment_number: installment.payment_number, total_payments: installment.total_payments },
        });
        results.skipped++;
        continue;
      }

      // Stage 3: атомарный lock pending → processing (защита от параллельных cron)
      const { data: lockedRows, error: lockError } = await supabase
        .from('installment_payments')
        .update({
          status: 'processing',
          last_attempt_at: new Date().toISOString(),
          charge_attempts: (installment.charge_attempts || 0) + 1,
        })
        .eq('id', installment.id)
        .eq('status', 'pending')
        .select('id');

      if (lockError || !lockedRows || lockedRows.length === 0) {
        console.log(`Пропуск платежа ${installment.id}: не удалось захватить lock (уже обработан другим процессом)`);
        results.skipped++;
        continue;
      }

      const tokenResult = await getSubscriptionToken(supabase, subscription.id);

      if (isSkip(tokenResult)) {
        console.log(`Skipping installment ${installment.id}: ${tokenResult.reason}`, tokenResult.details);

        // Audit ghost-token и payment_method_inactive
        if (tokenResult.reason === 'ghost_token_no_payment_method' || tokenResult.reason === 'payment_method_inactive') {
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_label: 'installment-charge-cron',
            action: `installment.token_resolve.${tokenResult.reason}`,
            meta: {
              installment_id: installment.id,
              subscription_id: subscription.id,
              ...tokenResult.details,
            },
          });
        }
        results.skipped++;
        continue;
      }

      const effectiveToken = tokenResult.token;
      console.log(`Token resolved for installment ${installment.id} via ${tokenResult.source}`);


      try {
        // Stage 3: lock уже захвачен выше через атомарный update pending → processing

        // Create payment record
        const { data: payment, error: paymentError } = await supabase
          .from('payments_v2')
          .insert({
            order_id: installment.order_id,
            user_id: installment.user_id,
            amount: installment.amount,
            currency: installment.currency,
            status: 'processing',
            provider: 'bepaid',
            payment_token: effectiveToken, // Use verified token from payment_methods
            is_recurring: true,
            installment_number: installment.payment_number,
            meta: {
              type: 'installment_auto_charge',
              installment_id: installment.id,
              subscription_id: subscription.id,
            },
          })
          .select()
          .single();

        if (paymentError) {
          throw new Error(`Failed to create payment record: ${paymentError.message}`);
        }

        // Charge the card
        const currency = subscription.products_v2?.currency || 'BYN';
        const productName = subscription.products_v2?.name || 'Продукт';

        const chargePayload = {
          request: {
            amount: Math.round(Number(installment.amount) * 100),
            currency,
            description: `Рассрочка ${installment.payment_number}/${installment.total_payments}: ${productName}`,
            tracking_id: payment.id,
            test: testMode,
          credit_card: {
              token: effectiveToken, // Use verified token from payment_methods
            },
            additional_data: {
              contract: ['recurring', 'unscheduled'],
            },
          },
        };

        console.log(`Charging installment ${installment.id}: ${installment.amount} ${currency}`);

        // PATCH-P0.9.1: audit marker before bePaid request
        await supabase.from('audit_logs').insert({
          action: 'bepaid.request.attempt',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'installment-charge-cron',
          meta: {
            fn: 'installment-charge-cron',
            endpoint: '/transactions/payments',
            shop_id_last4: String(shopId).slice(-4),
            test_mode: !!testMode,
          }
        });

        const chargeResponse = await fetch('https://gateway.bepaid.by/transactions/payments', {
          method: 'POST',
          headers: {
            'Authorization': bepaidAuth,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-API-Version': '2',
          },
          body: JSON.stringify(chargePayload),
        });

        const chargeResult = await chargeResponse.json();
        const txStatus = chargeResult.transaction?.status;
        const txUid = chargeResult.transaction?.uid;

        if (txStatus === 'successful') {
          // Update payment
          await supabase
            .from('payments_v2')
            .update({
              status: 'succeeded',
              paid_at: new Date().toISOString(),
              provider_payment_id: txUid,
              provider_response: chargeResult,
              receipt_url: chargeResult.transaction?.receipt_url || null,
            })
            .eq('id', payment.id);

          // Schedule receipt fetch in background
          fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/bepaid-fetch-receipt`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({ payment_id: payment.id }),
            }
          ).catch((e) => console.warn(`Receipt fetch failed:`, e));

          // Update installment
          await supabase
            .from('installment_payments')
            .update({
              status: 'succeeded',
              paid_at: new Date().toISOString(),
              payment_id: payment.id,
              error_message: null,
            })
            .eq('id', installment.id);

          // Update order paid_amount
          const { data: currentOrder } = await supabase
            .from('orders_v2')
            .select('paid_amount')
            .eq('id', installment.order_id)
            .single();

          await supabase
            .from('orders_v2')
            .update({ 
              paid_amount: (currentOrder?.paid_amount || 0) + Number(installment.amount),
            })
            .eq('id', installment.order_id);

          // Audit log
          await supabase.from('audit_logs').insert({
            actor_user_id: installment.user_id,
            action: 'payment.installment_auto_charged',
            meta: {
              installment_id: installment.id,
              payment_id: payment.id,
              payment_number: installment.payment_number,
              amount: installment.amount,
              bepaid_uid: txUid,
            },
          });

          console.log(`Installment ${installment.id} charged successfully`);
          results.successful++;

          // Stage 3: completion после последнего платежа рассрочки
          if (installment.payment_number >= installment.total_payments) {
            console.log(`Рассрочка завершена: подписка ${subscription.id}, платёж ${installment.payment_number}/${installment.total_payments}`);

            const { data: currentSub } = await supabase
              .from('subscriptions_v2')
              .select('meta, status')
              .eq('id', subscription.id)
              .single();

            const updatedMeta = {
              ...(currentSub?.meta || {}),
              installment_completed_at: new Date().toISOString(),
              installment_completed_payments: installment.total_payments,
            };

            // Используем 'expired' (статус 'completed' отсутствует в enum subscriptions_v2.status)
            await supabase
              .from('subscriptions_v2')
              .update({
                status: 'expired',
                next_charge_at: null,
                meta: updatedMeta,
              })
              .eq('id', subscription.id);

            await supabase.from('audit_logs').insert({
              actor_user_id: installment.user_id,
              actor_type: 'system',
              actor_label: 'installment-charge-cron',
              action: 'installment.completed',
              meta: {
                subscription_id: subscription.id,
                order_id: installment.order_id,
                total_payments: installment.total_payments,
                last_installment_id: installment.id,
                previous_status: currentSub?.status || null,
                new_status: 'expired',
              },
            });

            // Stage 4: best-effort completion email — отдельная тема «🎉 Рассрочка полностью оплачена»
            await notifyWithAudit(
              supabase,
              supabaseUrl,
              supabaseServiceKey,
              'completion',
              installment.id,
              {
                subscription_id: subscription.id,
                order_id: installment.order_id,
                payment_number: installment.payment_number,
                total_payments: installment.total_payments,
              },
            );
          }

          // Stage 4: best-effort success email с обязательным аудитом
          await notifyWithAudit(
            supabase,
            supabaseUrl,
            supabaseServiceKey,
            'success',
            installment.id,
            {
              subscription_id: subscription.id,
              payment_number: installment.payment_number,
              total_payments: installment.total_payments,
            },
          );
        } else {
          // Payment failed
          const errorMessage = chargeResult.transaction?.message || chargeResult.errors?.base?.[0] || 'Payment failed';
          
          await supabase
            .from('payments_v2')
            .update({
              status: 'failed',
              error_message: errorMessage,
              provider_response: chargeResult,
            })
            .eq('id', payment.id);

          // Update installment - back to pending or failed if max attempts (5 with backoff)
          const maxAttempts = 5;
          const newAttempts = (installment.charge_attempts || 0) + 1;
          const newStatus = newAttempts >= maxAttempts ? 'failed' : 'pending';
          
          await supabase
            .from('installment_payments')
            .update({ 
              status: newStatus,
              error_message: errorMessage,
            })
            .eq('id', installment.id);

          // Stage 4: best-effort failed email с обязательным аудитом
          await notifyWithAudit(
            supabase,
            supabaseUrl,
            supabaseServiceKey,
            'failed',
            installment.id,
            {
              subscription_id: subscription.id,
              payment_number: installment.payment_number,
              total_payments: installment.total_payments,
              error_message: errorMessage,
            },
          );

          // Send Telegram notification about failed payment
          const productName = subscription.products_v2?.name || 'Продукт';
          const currency = subscription.products_v2?.currency || 'BYN';
          await sendPaymentFailureNotification(
            supabase,
            installment.user_id,
            productName,
            installment.amount,
            currency,
            errorMessage,
            installment.payment_number,
            installment.total_payments
          );

          console.error(`Installment ${installment.id} charge failed: ${errorMessage}`);
          results.failed++;
          results.errors.push(`${installment.id}: ${errorMessage}`);
        }
      } catch (error) {
        console.error(`Error processing installment ${installment.id}:`, error);
        
        // Revert to pending status
        await supabase
          .from('installment_payments')
          .update({ 
            status: 'pending',
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', installment.id);

        results.failed++;
        results.errors.push(`${installment.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Small delay between charges to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('Installment charge cron completed:', results);

    return new Response(JSON.stringify({
      success: true,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Installment charge cron error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
