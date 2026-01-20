import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getOrderUserId } from '../_shared/user-resolver.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ManualChargeRequest {
  action: 'manual_charge' | 'charge_installment';
  user_id?: string;
  payment_method_id?: string;
  amount?: number; // in kopecks
  description?: string;
  installment_id?: string;
  product_id?: string;
  tariff_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - must be admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Not authorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin permission
    const { data: hasPermission } = await supabase.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'entitlements.manage',
    });

    if (!hasPermission) {
      return new Response(JSON.stringify({ success: false, error: 'Access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: ManualChargeRequest = await req.json();
    const { action } = body;

    // Get bePaid credentials from integration_instances (primary) or fallback
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .in('status', ['active', 'connected'])
      .maybeSingle();

    const bepaidSecretKey = bepaidInstance?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
    const bepaidShopIdFromInstance = bepaidInstance?.config?.shop_id || null;
    
    if (!bepaidSecretKey) {
      console.error('bePaid secret key not configured');
      return new Response(JSON.stringify({ success: false, error: 'Платёжная система не настроена' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Using bePaid credentials from:', bepaidInstance?.config?.secret_key ? 'integration_instances' : 'env');

    // Get additional settings from payment_settings
    const { data: settings } = await supabase
      .from('payment_settings')
      .select('key, value')
      .in('key', ['bepaid_shop_id', 'bepaid_test_mode']);

    const settingsMap: Record<string, string> = settings?.reduce(
      (acc: Record<string, string>, s: { key: string; value: string }) => ({ ...acc, [s.key]: s.value }),
      {}
    ) || {};

    // Priority: integration_instances > payment_settings > default
    const shopId = bepaidShopIdFromInstance || settingsMap['bepaid_shop_id'] || '33524';
    const testMode = settingsMap['bepaid_test_mode'] === 'true';
    const bepaidAuth = btoa(`${shopId}:${bepaidSecretKey}`);

    type ChargeCardResult = {
      success: boolean;
      uid?: string;
      error?: string;
      response?: any;
      requires_3ds?: boolean;
      redirect_url?: string | null;
      status?: string | null;
      code?: string | null;
    };

    // Helper function to charge a card
    async function chargeCard(
      paymentToken: string,
      amountKopecks: number,
      currency: string,
      description: string,
      trackingId: string,
      meta?: { order_id?: string; payment_id?: string },
    ): Promise<ChargeCardResult> {
      const reqOrigin = req.headers.get('origin');
      const reqReferer = req.headers.get('referer');
      const origin = reqOrigin || (reqReferer ? new URL(reqReferer).origin : null) || 'https://club.gorbova.by';

      // bePaid webhook receiver (so we can finalize payment after 3DS)
      const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;
      const returnUrl = `${origin}/admin/payments?payment=processing&payment=${trackingId}`;

      const chargePayload = {
        request: {
          amount: amountKopecks,
          currency,
          description,
          tracking_id: trackingId,
          test: testMode,
          return_url: returnUrl,
          notification_url: notificationUrl,
          // Try to bypass 3DS for saved-token charges (same as direct-charge)
          skip_three_d_secure_verification: true,
          credit_card: {
            token: paymentToken,
          },
          additional_data: {
            contract: ['recurring', 'unscheduled'],
            // Indicate this is a merchant-initiated transaction (for cards tokenized with recurring)
            card_on_file: {
              initiator: 'merchant',
              type: 'delayed_charge',
            },
            order_id: meta?.order_id,
            payment_id: meta?.payment_id ?? trackingId,
          },
        },
      };

      console.log('bePaid gateway URLs:', { origin, returnUrl, notificationUrl });
      console.log('Charging card:', JSON.stringify({ ...chargePayload, request: { ...chargePayload.request, credit_card: { token: '***' } } }));

      const chargeResponse = await fetch('https://gateway.bepaid.by/transactions/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${bepaidAuth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-API-Version': '2',
        },
        body: JSON.stringify(chargePayload),
      });

      const chargeResult = await chargeResponse.json();
      console.log('bePaid response:', JSON.stringify(chargeResult));

      if (!chargeResponse.ok) {
        return {
          success: false,
          error: chargeResult.message || chargeResult.error || `bePaid error: ${chargeResponse.status}`,
          response: chargeResult,
          status: chargeResult.transaction?.status ?? null,
          code: chargeResult.transaction?.code ?? null,
          redirect_url: chargeResult.transaction?.redirect_url ?? null,
        };
      }

      const txStatus = chargeResult.transaction?.status ?? null;
      const txUid = chargeResult.transaction?.uid;
      const txCode = chargeResult.transaction?.code;
      const redirectUrl = chargeResult.transaction?.redirect_url ?? null;

      if (txStatus === 'successful') {
        return { success: true, uid: txUid, response: chargeResult, status: txStatus, code: txCode, redirect_url: redirectUrl };
      }

      // Handle 3D-Secure / redirect required
      if (txStatus === 'incomplete' && (txCode === 'P.4011' || txCode === 'P.4012' || txCode?.startsWith('P.40'))) {
        return {
          success: false,
          requires_3ds: true,
          redirect_url: redirectUrl,
          uid: txUid,
          status: txStatus,
          code: txCode,
          error: 'Карта требует 3D-Secure верификацию. Для ручного списания используйте карту без 3DS или попросите клиента оплатить через форму.',
          response: chargeResult,
        };
      }

      // Handle other incomplete statuses
      if (txStatus === 'incomplete') {
        return {
          success: false,
          status: txStatus,
          code: txCode,
          redirect_url: redirectUrl,
          error: `Платёж не завершён: ${chargeResult.transaction?.message || chargeResult.transaction?.friendly_message || 'требуется дополнительная верификация'}`,
          response: chargeResult,
        };
      }

      // Handle failed/declined
      if (txStatus === 'failed' || txStatus === 'declined') {
        return {
          success: false,
          status: txStatus,
          code: txCode,
          redirect_url: redirectUrl,
          error: chargeResult.transaction?.message || 'Платёж отклонён',
          response: chargeResult,
        };
      }

      return {
        success: false,
        status: txStatus,
        code: txCode,
        redirect_url: redirectUrl,
        error: chargeResult.transaction?.message || `Неизвестный статус: ${txStatus}`,
        response: chargeResult,
      };
    }

    // ACTION: Manual charge
    if (action === 'manual_charge') {
      const { user_id: inputUserId, payment_method_id, amount, description, product_id, tariff_id } = body;

      if (!inputUserId || !payment_method_id || !amount || !product_id || !tariff_id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing required fields: user_id, payment_method_id, amount, product_id, tariff_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Normalize user_id (handle profile.id vs user_id confusion)
      const resolved = await getOrderUserId(supabase, inputUserId);
      const user_id = resolved.userId;
      
      if (resolved.wasNormalized) {
        console.log(`[admin-manual-charge] Normalized user_id: ${inputUserId} -> ${user_id} (was profile.id)`);
      }

      // Get payment method
      const { data: paymentMethod, error: pmError } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('id', payment_method_id)
        .eq('user_id', user_id)
        .eq('status', 'active')
        .single();

      if (pmError || !paymentMethod) {
        return new Response(JSON.stringify({ success: false, error: 'Payment method not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if card supports recurring (was tokenized with contract: ["recurring"])
      // Cards tokenized BEFORE the fix have supports_recurring = NULL, so check !== true
      if (paymentMethod.supports_recurring !== true) {
        console.log(`Card ${paymentMethod.id} does not support recurring (supports_recurring=${paymentMethod.supports_recurring}) - was tokenized before the fix`);
        return new Response(
          JSON.stringify({
            success: false,
            error:
              'Эта карта была привязана до обновления системы и не поддерживает автоматические списания. Попросите клиента перепривязать карту в Личном кабинете.',
            requires_rebind: true,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Get product and tariff info for order details
      const { data: product } = await supabase
        .from('products_v2')
        .select('name, code')
        .eq('id', product_id)
        .single();

      const { data: tariff } = await supabase
        .from('tariffs')
        .select('name, duration_days, access_duration_days')
        .eq('id', tariff_id)
        .single();

      // Generate order number
      const { data: orderNumberData } = await supabase.rpc('generate_order_number');
      const orderNumber = orderNumberData || `ORD-ADM-${Date.now()}`;

      // Create order for manual charge with product/tariff
      const { data: order, error: orderError } = await supabase
        .from('orders_v2')
        .insert({
          order_number: orderNumber,
          user_id,
          product_id,
          tariff_id,
          base_price: amount / 100, // Convert from kopecks to BYN
          final_price: amount / 100,
          paid_amount: 0,
          currency: 'BYN',
          status: 'pending',
          customer_email: paymentMethod.meta?.email || null,
          meta: {
            type: 'admin_manual_charge',
            description,
            charged_by: user.id,
            charged_by_action: 'admin_charge_dialog',
            product_name: product?.name,
            tariff_name: tariff?.name,
          },
        })
        .select()
        .single();

      if (orderError) {
        console.error('Order creation error:', orderError);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create order' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create payment record
      const { data: payment, error: paymentError } = await supabase
        .from('payments_v2')
        .insert({
          order_id: order.id,
          user_id,
          amount: amount / 100, // Convert from kopecks to BYN
          currency: 'BYN',
          status: 'processing',
          provider: 'bepaid',
          payment_token: paymentMethod.provider_token,
          is_recurring: false,
          meta: { 
            type: 'admin_manual_charge',
            description,
            charged_by: user.id,
            payment_method_id,
          },
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Payment record error:', paymentError);
        // Cleanup the order
        await supabase.from('orders_v2').delete().eq('id', order.id);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create payment record' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Charge the card
      const chargeResult = await chargeCard(
        paymentMethod.provider_token,
        amount,
        'BYN',
        description || 'Ручное списание',
        payment.id,
        { order_id: order.id, payment_id: payment.id },
      );

      if (chargeResult.success) {
        // Update payment as succeeded
        await supabase
          .from('payments_v2')
          .update({
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            provider_payment_id: chargeResult.uid,
            provider_response: chargeResult.response,
            card_brand: paymentMethod.brand,
            card_last4: paymentMethod.last4,
          })
          .eq('id', payment.id);

        // Update order as paid/completed
        await supabase
          .from('orders_v2')
          .update({
            status: 'paid',
            paid_amount: amount / 100,
          })
          .eq('id', order.id);

        // Calculate access dates
        const now = new Date();
        const durationDays = tariff?.access_duration_days || tariff?.duration_days || 365;
        const accessEnd = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

        // NOTE: Subscription creation is now handled by grant-access-for-order
        // to avoid duplicates and properly extend existing subscriptions

        // Grant access via centralized function (handles entitlements, Telegram, GetCourse)
        try {
          const grantResult = await supabase.functions.invoke('grant-access-for-order', {
            body: {
              orderId: order.id,
              grantTelegram: true,
              grantGetcourse: true,
            },
          });
          console.log('Access grant result:', grantResult.data);
          if (grantResult.error) {
            console.error('Access grant error:', grantResult.error);
          }
        } catch (grantError) {
          console.error('Access grant exception (non-critical):', grantError);
        }

        // Notify admins about the payment
        try {
          const { data: customerProfile } = await supabase
            .from('profiles')
            .select('full_name, email, phone, telegram_username')
            .eq('user_id', user_id)
            .single();

          const notifyMessage = `💳 <b>Ручное списание</b>\n\n` +
            `👤 <b>Клиент:</b> ${customerProfile?.full_name || 'Не указано'}\n` +
            `📧 Email: ${customerProfile?.email || 'Не указан'}\n` +
            `📱 Телефон: ${customerProfile?.phone || 'Не указан'}\n` +
            (customerProfile?.telegram_username ? `💬 Telegram: @${customerProfile.telegram_username}\n` : '') +
            `\n📦 <b>Продукт:</b> ${product?.name || 'N/A'}\n` +
            `📋 Тариф: ${tariff?.name || 'N/A'}\n` +
            `💵 Сумма: ${amount / 100} BYN\n` +
            `🆔 Заказ: ${orderNumber}\n` +
            `👨‍💼 Админ: ${user.email}`;

          const { data: notifyData, error: notifyInvokeError } = await supabase.functions.invoke('telegram-notify-admins', {
            body: { 
              message: notifyMessage, 
              parse_mode: 'HTML',
              source: 'admin_manual_charge',
              order_id: order.id,
              order_number: orderNumber,
              payment_id: payment.id,
            },
          });
          
          if (notifyInvokeError) {
            console.error('Admin notification invoke error:', notifyInvokeError);
          } else if (notifyData?.sent === 0) {
            console.warn('Admin notification sent=0:', notifyData);
          } else {
            console.log('Admin notification sent for manual charge:', notifyData);
          }
        } catch (notifyError) {
          console.error('Admin notification error (non-critical):', notifyError);
        }

        // Audit log
        await supabase.from('audit_logs').insert({
          actor_user_id: user.id,
          target_user_id: user_id,
          action: 'payment.admin_manual_charge',
          meta: {
            payment_id: payment.id,
            order_id: order.id,
            order_number: orderNumber,
            // subscription_id handled by grant-access-for-order
            product_id,
            tariff_id,
            product_name: product?.name,
            tariff_name: tariff?.name,
            amount: amount / 100,
            currency: 'BYN',
            description,
            bepaid_uid: chargeResult.uid,
            card_brand: paymentMethod.brand,
            card_last4: paymentMethod.last4,
            access_start: now.toISOString(),
            access_end: accessEnd.toISOString(),
          },
        });

        console.log(`Manual charge successful: order=${orderNumber}, payment=${payment.id}, amount=${amount / 100} BYN`);

        return new Response(JSON.stringify({
          success: true,
          payment_id: payment.id,
          order_id: order.id,
          order_number: orderNumber,
          // subscription handled by grant-access-for-order
          bepaid_uid: chargeResult.uid,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // If 3DS is required, keep records in "processing" so the webhook can finalize after verification
        if (chargeResult.requires_3ds && chargeResult.redirect_url) {
          await supabase
            .from('payments_v2')
            .update({
              status: 'processing',
              provider_payment_id: chargeResult.uid || null,
              provider_response: chargeResult.response,
              error_message: chargeResult.error,
            })
            .eq('id', payment.id);

          await supabase
            .from('orders_v2')
            .update({
              status: 'pending',
              meta: {
                ...order.meta,
                requires_3ds: true,
                redirect_url: chargeResult.redirect_url,
                error: chargeResult.error,
              },
            })
            .eq('id', order.id);

          await supabase.from('audit_logs').insert({
            actor_user_id: user.id,
            target_user_id: user_id,
            action: 'payment.admin_manual_charge_requires_3ds',
            meta: {
              payment_id: payment.id,
              order_id: order.id,
              order_number: orderNumber,
              code: chargeResult.code,
              redirect_url: chargeResult.redirect_url,
            },
          });

          return new Response(
            JSON.stringify({
              success: false,
              error: chargeResult.error,
              requires_3ds: true,
              redirect_url: chargeResult.redirect_url,
              payment_id: payment.id,
              order_number: orderNumber,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        // Non-3DS failure: mark as failed/cancelled
        await supabase
          .from('payments_v2')
          .update({
            status: 'failed',
            error_message: chargeResult.error,
            provider_response: chargeResult.response,
          })
          .eq('id', payment.id);

        await supabase
          .from('orders_v2')
          .update({
            status: 'cancelled',
            meta: {
              ...order.meta,
              error: chargeResult.error,
            },
          })
          .eq('id', order.id);

        // Audit log for failed charge
        await supabase.from('audit_logs').insert({
          actor_user_id: user.id,
          target_user_id: user_id,
          action: 'payment.admin_manual_charge_failed',
          meta: {
            payment_id: payment.id,
            order_id: order.id,
            order_number: orderNumber,
            product_id,
            tariff_id,
            amount: amount / 100,
            error: chargeResult.error,
            card_brand: paymentMethod.brand,
            card_last4: paymentMethod.last4,
          },
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: chargeResult.error,
            payment_id: payment.id,
            order_number: orderNumber,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // ACTION: Charge installment
    if (action === 'charge_installment') {
      const { installment_id } = body;

      if (!installment_id) {
        return new Response(JSON.stringify({ success: false, error: 'Missing installment_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get installment with subscription and payment method
      const { data: installment, error: instError } = await supabase
        .from('installment_payments')
        .select(`
          *,
          subscriptions_v2 (
            id, user_id, payment_method_id, payment_token,
            products_v2 ( name, currency )
          )
        `)
        .eq('id', installment_id)
        .eq('status', 'pending')
        .single();

      if (instError || !installment) {
        return new Response(JSON.stringify({ success: false, error: 'Installment not found or already processed' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const subscription = installment.subscriptions_v2;
      if (!subscription?.payment_token) {
        return new Response(JSON.stringify({ success: false, error: 'No payment token for subscription' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update installment status to processing
      await supabase
        .from('installment_payments')
        .update({ 
          status: 'processing',
          last_attempt_at: new Date().toISOString(),
          charge_attempts: (installment.charge_attempts || 0) + 1,
        })
        .eq('id', installment_id);

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
          payment_token: subscription.payment_token,
          is_recurring: true,
          installment_number: installment.payment_number,
          meta: {
            type: 'installment_charge',
            installment_id: installment.id,
            subscription_id: subscription.id,
            charged_by: user.id,
          },
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Payment record error:', paymentError);
        await supabase
          .from('installment_payments')
          .update({ status: 'pending', error_message: 'Failed to create payment record' })
          .eq('id', installment_id);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create payment record' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Charge the card
      const currency = subscription.products_v2?.currency || 'BYN';
      const productName = subscription.products_v2?.name || 'Продукт';
      const chargeResult = await chargeCard(
        subscription.payment_token,
        Math.round(Number(installment.amount) * 100),
        currency,
        `Рассрочка ${installment.payment_number}/${installment.total_payments}: ${productName}`,
        payment.id,
        { order_id: installment.order_id, payment_id: payment.id },
      );

      if (chargeResult.success) {
        // Update payment
        await supabase
          .from('payments_v2')
          .update({
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            provider_payment_id: chargeResult.uid,
            provider_response: chargeResult.response,
          })
          .eq('id', payment.id);

        // Schedule receipt fetch (fire and forget - cron will catch any missed)
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
        ).then(async (res) => {
          const result = await res.json();
          console.log(`Receipt fetch result for ${payment.id}:`, result);
        }).catch((e) => {
          console.warn(`Failed to fetch receipt for ${payment.id}:`, e);
        });

        // Update installment
        await supabase
          .from('installment_payments')
          .update({
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            payment_id: payment.id,
            error_message: null,
          })
          .eq('id', installment_id);

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
          actor_user_id: user.id,
          target_user_id: installment.user_id,
          action: 'payment.installment_charged',
          meta: {
            installment_id: installment.id,
            payment_id: payment.id,
            payment_number: installment.payment_number,
            amount: installment.amount,
            bepaid_uid: chargeResult.uid,
          },
        });

        console.log(`Installment charge successful: ${installment_id}, payment: ${payment.id}`);

        return new Response(JSON.stringify({
          success: true,
          payment_id: payment.id,
          installment_id,
          bepaid_uid: chargeResult.uid,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // Update payment as failed
        await supabase
          .from('payments_v2')
          .update({
            status: 'failed',
            error_message: chargeResult.error,
            provider_response: chargeResult.response,
          })
          .eq('id', payment.id);

        // Update installment status back to pending (or failed if max attempts)
        const maxAttempts = 3;
        const newStatus = (installment.charge_attempts || 0) + 1 >= maxAttempts ? 'failed' : 'pending';
        
        await supabase
          .from('installment_payments')
          .update({ 
            status: newStatus,
            error_message: chargeResult.error,
          })
          .eq('id', installment_id);

        return new Response(
          JSON.stringify({
            success: false,
            error: chargeResult.error,
            requires_3ds: !!chargeResult.requires_3ds,
            redirect_url: chargeResult.redirect_url || null,
            payment_id: payment.id,
            installment_id,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Admin manual charge error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
