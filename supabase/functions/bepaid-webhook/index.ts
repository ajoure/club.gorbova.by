import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send order to GetCourse
// Now uses getcourse_offer_id from tariffs table instead of hardcoded mapping
interface GetCourseUserData {
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

async function sendToGetCourse(
  userData: GetCourseUserData,
  offerId: number,
  orderNumber: string,
  amount: number,
  tariffCode: string
): Promise<{ success: boolean; error?: string; gcOrderId?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log(`No getcourse_offer_id for tariff: ${tariffCode}, skipping GetCourse sync`);
    return { success: false, error: `No GetCourse offer ID for tariff: ${tariffCode}` };
  }
  
  try {
    console.log(`Sending order to GetCourse: email=${userData.email}, offerId=${offerId}, orderNumber=${orderNumber}`);
    
    // GetCourse API expects form-encoded data with action and params
    const params = {
      user: {
        email: userData.email,
        phone: userData.phone || undefined,
        first_name: userData.firstName || undefined,
        last_name: userData.lastName || undefined,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        offer_code: offerId.toString(),
        deal_cost: amount / 100, // Convert from kopecks
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Оплата через сайт club.gorbova.by. Order: ${orderNumber}`,
      },
    };
    
    console.log('GetCourse params:', JSON.stringify(params, null, 2));
    
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
    console.log('GetCourse response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    // Check result.success, not top-level success (which is just API call status)
    if (data.result?.success === true) {
      console.log('Order successfully sent to GetCourse, deal_id:', data.result?.deal_id);
      return { success: true, gcOrderId: data.result?.deal_id?.toString() };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// AmoCRM integration helpers
function normalizeAmoCRMSubdomain(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/([a-z0-9-]+)\.amocrm\.(ru|com)/i);
  if (match?.[1]) return match[1].toLowerCase();

  const withoutProto = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^https?\/\//i, '');

  const host = withoutProto.split('/')[0];
  return host.split('.')[0].toLowerCase();
}

async function createAmoCRMContact(
  name: string,
  email: string,
  phone?: string
): Promise<number | null> {
  const accessToken = Deno.env.get('AMOCRM_ACCESS_TOKEN');
  const subdomainRaw = Deno.env.get('AMOCRM_SUBDOMAIN');
  const subdomain = subdomainRaw ? normalizeAmoCRMSubdomain(subdomainRaw) : null;

  if (!accessToken || !subdomain) {
    console.log('AmoCRM not configured, skipping contact creation');
    return null;
  }

  try {
    // First search for existing contact
    const searchResponse = await fetch(
      `https://${subdomain}.amocrm.ru/api/v4/contacts?query=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData._embedded?.contacts?.length > 0) {
        console.log('AmoCRM contact already exists:', searchData._embedded.contacts[0].id);
        return searchData._embedded.contacts[0].id;
      }
    }

    // Create new contact
    const contact = {
      name: name || email.split('@')[0],
      custom_fields_values: [
        { field_id: 413855, values: [{ value: email }] }, // Email field
      ],
    };

    if (phone) {
      contact.custom_fields_values.push({
        field_id: 413853,
        values: [{ value: phone }],
      });
    }

    const createResponse = await fetch(
      `https://${subdomain}.amocrm.ru/api/v4/contacts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([contact]),
      }
    );

    if (createResponse.ok) {
      const data = await createResponse.json();
      const contactId = data._embedded?.contacts?.[0]?.id;
      console.log('AmoCRM contact created:', contactId);
      return contactId;
    } else {
      console.error('Failed to create AmoCRM contact:', await createResponse.text());
    }
  } catch (error) {
    console.error('AmoCRM contact creation error:', error);
  }

  return null;
}

async function createAmoCRMDeal(
  name: string,
  price: number,
  contactId?: number | null,
  meta?: Record<string, any>
): Promise<number | null> {
  const accessToken = Deno.env.get('AMOCRM_ACCESS_TOKEN');
  const subdomainRaw = Deno.env.get('AMOCRM_SUBDOMAIN');
  const subdomain = subdomainRaw ? normalizeAmoCRMSubdomain(subdomainRaw) : null;

  if (!accessToken || !subdomain) {
    console.log('AmoCRM not configured, skipping deal creation');
    return null;
  }

  try {
    const deal: any = {
      name,
      price,
    };

    if (contactId) {
      deal._embedded = {
        contacts: [{ id: contactId }],
      };
    }

    const response = await fetch(
      `https://${subdomain}.amocrm.ru/api/v4/leads`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([deal]),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const dealId = data._embedded?.leads?.[0]?.id;
      console.log('AmoCRM deal created:', dealId);
      return dealId;
    } else {
      console.error('Failed to create AmoCRM deal:', await response.text());
    }
  } catch (error) {
    console.error('AmoCRM deal creation error:', error);
  }

  return null;
}


// Verify webhook signature using HMAC-SHA256
async function verifyWebhookSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) {
    return false;
  }
  
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expectedSignature = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Compare signatures (case-insensitive)
    return signature.toLowerCase() === expectedSignature.toLowerCase();
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resend = resendApiKey ? new Resend(resendApiKey) : null;

    // Read body as text for signature verification
    const bodyText = await req.text();
    
    // Log webhook signature header for debugging
    const signatureHeader = req.headers.get('X-Webhook-Signature') || 
                            req.headers.get('Authorization')?.replace('Bearer ', '') || null;
    console.log('Webhook signature header:', signatureHeader ? 'present' : 'missing');
    
    // NOTE: bePaid subscription webhooks may not include signature in all cases
    // We still process the webhook but log a warning
    if (bepaidSecretKey && signatureHeader) {
      const isValid = await verifyWebhookSignature(bodyText, signatureHeader, bepaidSecretKey);
      
      if (!isValid) {
        // Log warning but don't reject - bePaid may use different signature format
        console.warn('bePaid webhook signature verification failed - processing anyway');
      } else {
        console.log('bePaid webhook signature verified successfully');
      }
    } else {
      console.log('Webhook signature verification skipped (no signature or secret)');
    }

    const body = JSON.parse(bodyText);
    console.log('bePaid webhook received:', JSON.stringify(body, null, 2));

    // bePaid sends subscription webhooks with data directly in body (not nested in .subscription)
    // Check if this is a subscription webhook (has 'state' and 'plan' fields directly in body)
    const isSubscriptionWebhook = body.state && body.plan;
    
    // For subscription webhooks, the subscription data IS the body
    const subscription = isSubscriptionWebhook ? body : (body.subscription || null);
    
    // bePaid can send either transaction webhooks or subscription webhooks
    const transaction = body.transaction || subscription?.last_transaction || null;

    // Get tracking_id from multiple possible locations
    const orderId = body.tracking_id ||
                    body.additional_data?.order_id ||
                    transaction?.tracking_id ||
                    subscription?.tracking_id ||
                    null;

    const transactionStatus = transaction?.status || null;
    const transactionUid = transaction?.uid || null;
    const paymentMethod = transaction?.payment_method_type || transaction?.payment_method || null;
    const subscriptionId = body.id || subscription?.id || null;
    const subscriptionState = body.state || subscription?.state || null;

    console.log(`Processing bePaid webhook: order=${orderId}, transaction=${transactionUid}, status=${transactionStatus}, subscription=${subscriptionId}, state=${subscriptionState}`);

    // ---------------------------------------------------------------------
    // V2 direct-charge support
    // In direct-charge we send tracking_id = payments_v2.id (UUID).
    // This block finalizes orders_v2/payments_v2/subscriptions_v2 for 3DS flows.
    // ---------------------------------------------------------------------
    let paymentV2: any = null;
    if (orderId) {
      const { data: p2, error: p2Err } = await supabase
        .from('payments_v2')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (!p2Err && p2) paymentV2 = p2;
    }

    if (paymentV2) {
      const now = new Date();

      // Keep provider response for debugging
      const basePaymentUpdate: Record<string, any> = {
        provider_payment_id: transactionUid || paymentV2.provider_payment_id || null,
        provider_response: body,
        error_message: transaction?.message || null,
        card_brand: transaction?.credit_card?.brand || paymentV2.card_brand || null,
        card_last4: transaction?.credit_card?.last_4 || paymentV2.card_last4 || null,
      };

      if (transactionStatus === 'successful') {
        await supabase
          .from('payments_v2')
          .update({
            ...basePaymentUpdate,
            status: 'succeeded',
            paid_at: now.toISOString(),
          })
          .eq('id', paymentV2.id);

        // Update order
        const { data: orderV2 } = await supabase
          .from('orders_v2')
          .select('*')
          .eq('id', paymentV2.order_id)
          .maybeSingle();

        if (orderV2 && orderV2.status !== 'paid') {
          await supabase
            .from('orders_v2')
            .update({
              status: 'paid',
              paid_amount: paymentV2.amount,
              meta: {
                ...(orderV2.meta || {}),
                bepaid_uid: transactionUid,
                payment_id: paymentV2.id,
              },
            })
            .eq('id', orderV2.id);

          // Fetch product + tariff for access calculation
          const { data: productV2 } = await supabase
            .from('products_v2')
            .select('id, name, currency, telegram_club_id')
            .eq('id', orderV2.product_id)
            .maybeSingle();

          const { data: tariff } = await supabase
            .from('tariffs')
            .select('id, name, code, access_days, getcourse_offer_id')
            .eq('id', orderV2.tariff_id)
            .maybeSingle();

          // Get offer settings to check if this is a subscription or one-time payment
          const offerType = orderV2.is_trial ? 'trial' : 'pay_now';
          const { data: offer } = await supabase
            .from('tariff_offers')
            .select('requires_card_tokenization, auto_charge_after_trial, getcourse_offer_id')
            .eq('tariff_id', orderV2.tariff_id)
            .eq('offer_type', offerType)
            .eq('is_active', true)
            .order('is_primary', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Determine if this should be a recurring subscription
          const isRecurringSubscription = offer?.requires_card_tokenization ?? false;
          const autoChargeAfterTrial = offer?.auto_charge_after_trial ?? true;

          if (productV2 && tariff) {
            // Find existing active subscription to check for tariff change (proration)
            // IMPORTANT: exclude canceled subscriptions (canceled_at IS NOT NULL)
            let existingSub: { id: string; access_end_at: string; canceled_at: string | null; tariff_id: string; order_id: string | null } | null = null;
            
            if (!orderV2.is_trial) {
              const { data } = await supabase
                .from('subscriptions_v2')
                .select('id, access_end_at, canceled_at, tariff_id, order_id')
                .eq('user_id', orderV2.user_id)
                .eq('product_id', orderV2.product_id)
                .in('status', ['active', 'trial'])
                .is('canceled_at', null) // Only extend non-canceled subscriptions
                .gte('access_end_at', now.toISOString()) // Only extend subscriptions still in the future
                .order('access_end_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              
              existingSub = data;
            }

            const isSameTariff = existingSub && existingSub.tariff_id === orderV2.tariff_id;
            
            // Calculate proration for tariff change
            interface ProrationResult {
              bonusDays: number;
              unusedValue: number;
              remainingDays: number;
              oldTariffId: string;
            }
            let prorationResult: ProrationResult | null = null;
            
            if (existingSub && !isSameTariff && !orderV2.is_trial && existingSub.order_id) {
              console.log(`Webhook: User is changing tariff from ${existingSub.tariff_id} to ${orderV2.tariff_id}, calculating proration...`);
              
              // Get paid amount from old order
              const { data: oldOrder } = await supabase
                .from('orders_v2')
                .select('paid_amount, final_price')
                .eq('id', existingSub.order_id)
                .single();
              
              // Get access_days from old tariff
              const { data: oldTariff } = await supabase
                .from('tariffs')
                .select('access_days')
                .eq('id', existingSub.tariff_id)
                .single();
              
              if (oldOrder && oldTariff?.access_days) {
                const oldPaidAmount = oldOrder.paid_amount || oldOrder.final_price || 0;
                const accessEnd = new Date(existingSub.access_end_at);
                const remainingMs = accessEnd.getTime() - now.getTime();
                const remainingDays = Math.max(0, remainingMs / (24 * 60 * 60 * 1000));
                
                if (remainingDays > 0 && oldPaidAmount > 0) {
                  const oldDailyRate = oldPaidAmount / oldTariff.access_days;
                  const unusedValue = oldDailyRate * remainingDays;
                  const newDailyRate = paymentV2.amount / tariff.access_days;
                  const bonusDays = newDailyRate > 0 ? Math.floor(unusedValue / newDailyRate) : 0;
                  
                  prorationResult = {
                    bonusDays,
                    unusedValue,
                    remainingDays,
                    oldTariffId: existingSub.tariff_id,
                  };
                  
                  console.log(`Webhook proration: ${remainingDays.toFixed(1)} days remaining, bonus: ${bonusDays} days`);
                }
              }
            }

            const baseAccessDays = orderV2.is_trial
              ? Math.max(1, Math.ceil((new Date(orderV2.trial_end_at).getTime() - new Date(orderV2.created_at).getTime()) / (24 * 60 * 60 * 1000)))
              : (tariff.access_days || 30);
            
            const prorationBonusDays = prorationResult?.bonusDays || 0;
            const accessDays = baseAccessDays + prorationBonusDays;

            // For same tariff non-trial: extend from existing subscription end date
            const extendFromDate = (existingSub && isSameTariff && !orderV2.is_trial) ? new Date(existingSub.access_end_at) : null;
            const baseDate = extendFromDate || new Date();
            const accessEndAt = orderV2.is_trial
              ? new Date(orderV2.trial_end_at)
              : new Date(baseDate.getTime() + accessDays * 24 * 60 * 60 * 1000);

            // Set next_charge_at only if this is a recurring subscription or trial with auto-charge
            let nextChargeAt: Date | null = null;
            if (orderV2.is_trial && autoChargeAfterTrial) {
              nextChargeAt = new Date(accessEndAt.getTime() - 24 * 60 * 60 * 1000);
            } else if (!orderV2.is_trial && isRecurringSubscription) {
              nextChargeAt = new Date(accessEndAt.getTime() - 3 * 24 * 60 * 60 * 1000);
            }
            // If not recurring subscription (one-time payment), next_charge_at stays null

            console.log('Subscription upsert logic:', {
              existingSubId: existingSub?.id,
              existingEndAt: existingSub?.access_end_at,
              isSameTariff,
              extendFromDate: extendFromDate?.toISOString(),
              baseAccessDays,
              prorationBonusDays,
              totalAccessDays: accessDays,
              newAccessEndAt: accessEndAt.toISOString(),
              nextChargeAt: nextChargeAt?.toISOString(),
              isRecurringSubscription,
            });

            if (existingSub && isSameTariff && !orderV2.is_trial) {
              // Update existing active subscription - extend it (same tariff)
              await supabase
                .from('subscriptions_v2')
                .update({
                  status: 'active',
                  is_trial: false,
                  access_end_at: accessEndAt.toISOString(),
                  next_charge_at: nextChargeAt?.toISOString() || null,
                  payment_method_id: (orderV2.meta as any)?.payment_method_id || null,
                  payment_token: paymentV2.payment_token || null,
                  updated_at: now.toISOString(),
                })
                .eq('id', existingSub.id);
              
              console.log('Updated existing subscription:', existingSub.id);
            } else {
              // Create new subscription (new tariff or upgrade/downgrade with proration)
              const subscriptionMeta = prorationResult ? {
                proration: {
                  from_tariff_id: prorationResult.oldTariffId,
                  remaining_days: Math.round(prorationResult.remainingDays * 10) / 10,
                  unused_value: Math.round(prorationResult.unusedValue),
                  bonus_days: prorationResult.bonusDays,
                }
              } : undefined;
              
              const { data: newSub } = await supabase
                .from('subscriptions_v2')
                .insert({
                  user_id: orderV2.user_id,
                  product_id: orderV2.product_id,
                  tariff_id: orderV2.tariff_id,
                  order_id: orderV2.id,
                  status: orderV2.is_trial ? 'trial' : 'active',
                  is_trial: !!orderV2.is_trial,
                  access_start_at: now.toISOString(),
                  access_end_at: accessEndAt.toISOString(),
                  trial_end_at: orderV2.is_trial ? accessEndAt.toISOString() : null,
                  next_charge_at: nextChargeAt?.toISOString() || null,
                  payment_method_id: (orderV2.meta as any)?.payment_method_id || null,
                  payment_token: paymentV2.payment_token || null,
                  meta: subscriptionMeta,
                })
                .select('id')
                .single();
              
              console.log('Created new subscription:', newSub?.id);
              
              // If tariff changed - cancel old subscription
              if (existingSub && !isSameTariff) {
                console.log(`Canceling old subscription ${existingSub.id} due to tariff change`);
                await supabase
                  .from('subscriptions_v2')
                  .update({
                    status: 'canceled',
                    canceled_at: now.toISOString(),
                    cancel_reason: `Changed to tariff. Proration: ${prorationBonusDays} bonus days applied.`,
                  })
                  .eq('id', existingSub.id);
              }
            }

            // Telegram access
            if (productV2.telegram_club_id) {
              await supabase.functions.invoke('telegram-grant-access', {
                body: {
                  user_id: orderV2.user_id,
                  duration_days: accessDays,
                },
              });
            }

            // GetCourse sync - prefer offer-level getcourse_offer_id, fallback to tariff-level
            const getcourseOfferId = offer?.getcourse_offer_id || tariff.getcourse_offer_id;
            if (getcourseOfferId && orderV2.customer_email) {
              console.log(`Syncing to GetCourse: offer_id=${getcourseOfferId}, email=${orderV2.customer_email}`);
              
              // Get customer data from profile
              const { data: profile } = await supabase
                .from('profiles')
                .select('phone, first_name, last_name')
                .eq('user_id', orderV2.user_id)
                .maybeSingle();

              const gcResult = await sendToGetCourse(
                {
                  email: orderV2.customer_email,
                  phone: profile?.phone || orderV2.customer_phone || null,
                  firstName: profile?.first_name || null,
                  lastName: profile?.last_name || null,
                },
                parseInt(getcourseOfferId, 10) || 0,
                orderV2.order_number,
                paymentV2.amount,
                tariff.code || tariff.name
              );
              
              console.log('GetCourse sync result (V2):', gcResult);
            }

            // Audit
            await supabase.from('audit_logs').insert({
              actor_user_id: orderV2.user_id,
              action: orderV2.is_trial ? 'subscription.trial_paid' : 'subscription.purchased',
              meta: {
                order_id: orderV2.id,
                payment_id: paymentV2.id,
                amount: paymentV2.amount,
                currency: paymentV2.currency,
                tariff_id: orderV2.tariff_id,
                product_id: orderV2.product_id,
                bepaid_uid: transactionUid,
              },
            });
          }
        }

        return new Response(JSON.stringify({ ok: true, mode: 'v2', status: 'successful' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (transactionStatus === 'incomplete') {
        await supabase
          .from('payments_v2')
          .update({
            ...basePaymentUpdate,
            status: 'processing',
          })
          .eq('id', paymentV2.id);

        return new Response(JSON.stringify({ ok: true, mode: 'v2', status: 'incomplete' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // failed / expired / other
      await supabase
        .from('payments_v2')
        .update({
          ...basePaymentUpdate,
          status: 'failed',
        })
        .eq('id', paymentV2.id);

      if (paymentV2.order_id) {
        await supabase
          .from('orders_v2')
          .update({ status: 'failed' })
          .eq('id', paymentV2.order_id);
      }

      return new Response(JSON.stringify({ ok: true, mode: 'v2', status: transactionStatus || 'unknown' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---------------------------------------------------------------------
    // Legacy flow (orders table)
    // ---------------------------------------------------------------------

    if (!orderId && !subscriptionId) {
      console.error('No tracking_id nor subscription id in webhook payload');
      return new Response(
        JSON.stringify({ error: 'Missing tracking_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the order
    let order: any = null;

    if (orderId) {
      const { data, error } = await supabase
        .from('orders')
        .select('*, products(*)')
        .eq('id', orderId)
        .maybeSingle();

      if (!error && data) order = data;
    }

    // Fallback: find order by subscription id saved in meta
    if (!order && subscriptionId) {
      const { data: subOrder, error: subOrderError } = await supabase
        .from('orders')
        .select('*, products(*)')
        .eq('meta->>bepaid_subscription_id', subscriptionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!subOrderError && subOrder) order = subOrder;
    }

    if (!order) {
      console.error('Order not found for webhook:', { orderId, subscriptionId });
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const internalOrderId = order.id as string;

    // Map bePaid status to our status
    let orderStatus = order.status;

    if (transactionStatus) {
      switch (transactionStatus) {
        case 'successful':
          orderStatus = 'completed';
          break;
        case 'failed':
        case 'expired':
          orderStatus = 'failed';
          break;
        case 'incomplete':
          orderStatus = 'processing';
          break;
        default:
          orderStatus = 'processing';
      }
    } else if (subscriptionState) {
      // Subscription webhooks - check subscription state
      // 'trial' and 'active' mean successful subscription
      if (subscriptionState === 'active' || subscriptionState === 'trial') {
        orderStatus = 'completed';
      } else if (subscriptionState === 'failed' || subscriptionState === 'canceled' || subscriptionState === 'expired') {
        orderStatus = 'failed';
      } else {
        orderStatus = 'processing';
      }
    } else {
      orderStatus = 'processing';
    }
    
    console.log(`Determined order status: ${orderStatus} (from transactionStatus=${transactionStatus}, subscriptionState=${subscriptionState})`);

    // Update order
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: orderStatus,
        bepaid_uid: transactionUid || null,
        payment_method: paymentMethod || null,
        error_message: transaction?.message || null,
        meta: {
          ...order.meta,
          ...(subscriptionId ? { bepaid_subscription_id: subscriptionId } : {}),
          ...(subscription ? { bepaid_subscription: subscription } : {}),
          ...(transaction ? { bepaid_response: transaction } : {}),
        },
      })
      .eq('id', internalOrderId);

    if (updateError) {
      console.error('Failed to update order:', updateError);
    }

    // If payment successful, grant entitlement and send email
    if (orderStatus === 'completed' && order.user_id) {
      let product = order.products;
      const meta = order.meta as Record<string, any> || {};
      
      // For products_v2: if no legacy product but we have product_v2_id, fetch from products_v2
      let productV2: any = null;
      let tariffData: any = null;
      
      if (!product && meta.product_v2_id) {
        console.log('Looking up product_v2:', meta.product_v2_id);
        const { data: v2Product } = await supabase
          .from('products_v2')
          .select('*')
          .eq('id', meta.product_v2_id)
          .maybeSingle();
        
        if (v2Product) {
          productV2 = v2Product;
          console.log('Found products_v2:', v2Product.name);
          
          // Get tariff data for access duration
          if (meta.tariff_code) {
            const { data: tariff } = await supabase
              .from('tariffs')
              .select('*, tariff_offers(*)')
              .eq('code', meta.tariff_code)
              .eq('product_id', meta.product_v2_id)
              .maybeSingle();
            
            if (tariff) {
              tariffData = tariff;
              console.log('Found tariff:', tariff.name, 'access_days:', tariff.access_days);
            }
          }
        }
      }
      
      // Detect duplicates by phone if phone is available
      if (meta.customer_phone) {
        try {
          const duplicateResult = await supabase.functions.invoke('detect-duplicates', {
            body: {
              phone: meta.customer_phone,
              email: order.customer_email,
            },
          });
          
          if (duplicateResult.data?.isDuplicate) {
            console.log(`Duplicate detected for order ${internalOrderId}, case: ${duplicateResult.data.caseId}`);
            await supabase
              .from('orders')
              .update({
                possible_duplicate: true,
                duplicate_reason: `Дубль по телефону: ${duplicateResult.data.duplicates?.length || 0} профилей`,
              })
              .eq('id', internalOrderId);
          }
        } catch (dupError) {
          console.error('Error detecting duplicates:', dupError);
        }
      }
      
      // Process products_v2 subscriptions
      if (productV2 && tariffData) {
        console.log(`Granting subscription for products_v2: ${productV2.name}, tariff: ${tariffData.name}`);
        
        // Calculate access duration - prioritize trial_days for trials
        let accessDays = tariffData.access_days || 30;
        if (meta.is_trial && meta.trial_days) {
          accessDays = meta.trial_days; // Trial period takes priority
          console.log(`Using trial_days from meta: ${accessDays}`);
        }
        
        const now = new Date();
        const accessEndAt = new Date(now);
        accessEndAt.setDate(accessEndAt.getDate() + accessDays);
        
        // Create order in orders_v2 for display in "My Purchases"
        const orderNumber = `ORD-${new Date().getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;
        const { data: orderV2, error: orderV2Error } = await supabase
          .from('orders_v2')
          .insert({
            order_number: orderNumber,
            user_id: order.user_id,
            product_id: productV2.id,
            tariff_id: tariffData.id,
            customer_email: order.customer_email,
            base_price: order.amount,
            final_price: order.amount,
            paid_amount: order.amount,
            currency: order.currency,
            status: 'paid',
            is_trial: meta.is_trial || false,
            trial_end_at: meta.is_trial ? accessEndAt.toISOString() : null,
            purchase_snapshot: {
              product_name: productV2.name,
              tariff_name: tariffData.name,
              tariff_code: meta.tariff_code,
              access_days: accessDays,
            },
            meta: {
              legacy_order_id: internalOrderId,
              bepaid_uid: transactionUid,
              bepaid_subscription_id: subscriptionId,
            },
          })
          .select()
          .single();
        
        if (orderV2Error) {
          console.error('Failed to create order_v2:', orderV2Error);
        } else {
          console.log('Created order_v2:', orderV2.id);
          
          // Create payment_v2 record for the order
          await supabase
            .from('payments_v2')
            .insert({
              order_id: orderV2.id,
              user_id: order.user_id,
              amount: order.amount,
              currency: order.currency,
              status: 'succeeded',
              provider: 'bepaid',
              provider_payment_id: transactionUid,
              payment_token: subscription?.card?.token || subscription?.token || null,
              card_brand: subscription?.card?.brand || null,
              card_last4: subscription?.card?.last_4 || null,
              paid_at: now.toISOString(),
              is_recurring: false,
              meta: {
                bepaid_subscription_id: subscriptionId,
              },
            });
        }
        
        // Create subscription in subscriptions_v2
        const { data: existingSub } = await supabase
          .from('subscriptions_v2')
          .select('id, access_end_at, status')
          .eq('user_id', order.user_id)
          .eq('product_id', productV2.id)
          .in('status', ['active', 'trial'])
          .maybeSingle();
        
        if (existingSub) {
          // Extend existing subscription
          const currentEnd = new Date(existingSub.access_end_at || now);
          const baseDate = currentEnd > now ? currentEnd : now;
          const newEndAt = new Date(baseDate);
          newEndAt.setDate(newEndAt.getDate() + accessDays);
          
          await supabase
            .from('subscriptions_v2')
            .update({
              access_end_at: newEndAt.toISOString(),
              is_trial: meta.is_trial || false,
              status: meta.is_trial ? 'trial' : 'active',
              trial_end_at: meta.is_trial ? accessEndAt.toISOString() : null,
              payment_token: subscription?.token || null,
              order_id: orderV2?.id || null,
            })
            .eq('id', existingSub.id);
          
          console.log('Extended existing subscription:', existingSub.id);
        } else {
          // Create new subscription
          const { error: subError } = await supabase
            .from('subscriptions_v2')
            .insert({
              user_id: order.user_id,
              product_id: productV2.id,
              tariff_id: tariffData.id,
              order_id: orderV2?.id || null,
              status: meta.is_trial ? 'trial' : 'active',
              is_trial: meta.is_trial || false,
              access_start_at: now.toISOString(),
              access_end_at: accessEndAt.toISOString(),
              trial_end_at: meta.is_trial ? accessEndAt.toISOString() : null,
              next_charge_at: meta.is_trial ? accessEndAt.toISOString() : null,
              payment_token: subscription?.card?.token || subscription?.token || null,
              meta: {
                tariff_code: meta.tariff_code,
                tariff_name: tariffData.name,
                bepaid_subscription_id: subscriptionId,
                auto_charge_amount: meta.auto_charge_amount,
                legacy_order_id: internalOrderId,
                trial_days: meta.trial_days || null,
              },
            });
          
          if (subError) {
            console.error('Failed to create subscription_v2:', subError);
          } else {
            console.log('Created new subscription_v2');
          }
        }
        
        // Grant Telegram access if product has telegram_club_id
        if (productV2.telegram_club_id) {
          console.log('Granting Telegram access for club:', productV2.telegram_club_id);
          
          try {
            const telegramGrantResult = await supabase.functions.invoke('telegram-grant-access', {
              body: { 
                user_id: order.user_id,
                club_ids: [productV2.telegram_club_id],
                duration_days: accessDays
              },
            });
            
            if (telegramGrantResult.error) {
              console.error('Failed to grant Telegram access:', telegramGrantResult.error);
            } else {
              console.log('Telegram access granted:', telegramGrantResult.data);
            }
            
            // Create telegram_access_grants record
            const endAt = new Date(now);
            endAt.setDate(endAt.getDate() + accessDays);
            
            await supabase
              .from('telegram_access_grants')
              .insert({
                user_id: order.user_id,
                club_id: productV2.telegram_club_id,
                source: 'order',
                source_id: internalOrderId,
                start_at: now.toISOString(),
                end_at: endAt.toISOString(),
                status: 'active',
                meta: {
                  product_v2_id: productV2.id,
                  product_name: productV2.name,
                  tariff_code: meta.tariff_code,
                  tariff_name: tariffData.name,
                  is_trial: meta.is_trial,
                  bepaid_uid: transactionUid,
                  amount: order.amount,
                  currency: order.currency,
                },
              });
            
            console.log('Created telegram_access_grant');
          } catch (telegramError) {
            console.error('Error handling Telegram access:', telegramError);
          }
        }
      }
      
      // Legacy product handling
      if (product) {
        console.log(`Granting entitlement for product: ${product.name}`);

        const productCode = product.product_type === 'subscription' ? (product.tier || 'pro') : product.id;

        // Calculate expiration date (extend from current expires_at if still active)
        let expiresAt = null;
        if (product.duration_days) {
          const { data: existingEnt } = await supabase
            .from('entitlements')
            .select('expires_at')
            .eq('user_id', order.user_id)
            .eq('product_code', productCode)
            .maybeSingle();

          const now = new Date();
          const currentExpires = existingEnt?.expires_at ? new Date(existingEnt.expires_at) : null;
          const baseDate = currentExpires && currentExpires > now ? currentExpires : now;

          expiresAt = new Date(baseDate);
          expiresAt.setDate(expiresAt.getDate() + product.duration_days);
        }

        // Create or update entitlement
        const { error: entitlementError } = await supabase
          .from('entitlements')
          .upsert({
            user_id: order.user_id,
            product_code: productCode,
            status: 'active',
            expires_at: expiresAt?.toISOString() || null,
            meta: {
              order_id: internalOrderId,
              product_name: product.name,
              bepaid_uid: transactionUid,
              bepaid_subscription_id: subscriptionId,
            },
          }, {
            onConflict: 'user_id,product_code',
          });

        if (entitlementError) {
          console.error('Failed to create entitlement:', entitlementError);
        }

        // Update subscription if it's a subscription product
        if (product.product_type === 'subscription' && product.tier) {
          const { error: subError } = await supabase
            .from('subscriptions')
            .update({
              tier: product.tier,
              is_active: true,
              starts_at: new Date().toISOString(),
              expires_at: expiresAt?.toISOString() || null,
            })
            .eq('user_id', order.user_id);

          if (subError) {
            console.error('Failed to update subscription:', subError);
          }
        }
      }

      // Grant Telegram access based on product_club_mappings (for selected products)
      if (product) {
        try {
          // Check if this product has club mappings
          const { data: mappings } = await supabase
            .from('product_club_mappings')
            .select('*, telegram_clubs(id, club_name)')
            .eq('product_id', product.id)
            .eq('is_active', true);

          if (mappings && mappings.length > 0) {
            console.log(`Found ${mappings.length} club mappings for product ${product.name}`);
            
            for (const mapping of mappings) {
              const durationDays = mapping.duration_days || product.duration_days || 30;
              
              // Grant access via edge function
              const telegramGrantResult = await supabase.functions.invoke('telegram-grant-access', {
                body: { 
                  user_id: order.user_id,
                  club_ids: [mapping.club_id],
                  duration_days: durationDays
                },
              });
              
              if (telegramGrantResult.error) {
                console.error('Failed to grant Telegram access:', telegramGrantResult.error);
              } else {
                console.log('Telegram access granted:', telegramGrantResult.data);
              }

              // Create telegram_access_grants record for history
              const startAt = new Date();
              const endAt = new Date();
              endAt.setDate(endAt.getDate() + durationDays);

              await supabase
                .from('telegram_access_grants')
                .insert({
                  user_id: order.user_id,
                  club_id: mapping.club_id,
                  source: 'order',
                  source_id: internalOrderId,
                  start_at: startAt.toISOString(),
                  end_at: endAt.toISOString(),
                  status: 'active',
                  meta: {
                    product_id: product.id,
                    product_name: product.name,
                    product_tier: product.tier,
                    bepaid_uid: transactionUid,
                    amount: order.amount,
                    currency: order.currency,
                  },
                });
            }
            console.log('Telegram access grants created for', mappings.length, 'clubs via product mappings');
          } else if (product.product_type === 'subscription' && product.duration_days) {
            // Fallback: if no explicit mapping but it's a subscription product, grant to all active clubs
            console.log('No explicit mappings, using fallback for subscription product');
            
            const telegramGrantResult = await supabase.functions.invoke('telegram-grant-access', {
              body: { 
                user_id: order.user_id,
                duration_days: product.duration_days
              },
            });
            
            if (telegramGrantResult.error) {
              console.error('Failed to grant Telegram access (fallback):', telegramGrantResult.error);
            } else {
              console.log('Telegram access granted (fallback):', telegramGrantResult.data);
            }

            // Create grants for all active clubs
            const { data: clubs } = await supabase
              .from('telegram_clubs')
              .select('id')
              .eq('is_active', true);

            if (clubs && clubs.length > 0) {
              const startAt = new Date();
              const endAt = new Date();
              endAt.setDate(endAt.getDate() + product.duration_days);

              for (const club of clubs) {
                await supabase
                  .from('telegram_access_grants')
                  .insert({
                    user_id: order.user_id,
                    club_id: club.id,
                     source: 'order',
                     source_id: internalOrderId,
                     start_at: startAt.toISOString(),
                    end_at: endAt.toISOString(),
                    status: 'active',
                    meta: {
                      product_name: product.name,
                      product_tier: product.tier,
                      bepaid_uid: transactionUid,
                      amount: order.amount,
                      currency: order.currency,
                    },
                  });
              }
              console.log('Telegram access grants created for', clubs.length, 'clubs (fallback)');
            }
          }
        } catch (telegramError) {
          console.error('Error handling Telegram access:', telegramError);
        }
      }

      // Create contact and deal in AmoCRM
      const customerName = meta.customer_first_name 
        ? `${meta.customer_first_name} ${meta.customer_last_name || ''}`.trim()
        : order.customer_email?.split('@')[0] || 'Клиент';
      
      const productName = product?.name || productV2?.name || meta.product_name || 'Подписка';
      
      const amoCRMContactId = await createAmoCRMContact(
        customerName,
        order.customer_email || '',
        meta.customer_phone
      );

      const amoCRMDealId = await createAmoCRMDeal(
        `Оплата: ${productName}`,
        order.amount, // Amount is already in BYN, not kopecks
        amoCRMContactId,
        {
          order_id: internalOrderId,
          product: productName,
          subscription_tier: product?.tier || tariffData?.code,
        }
      );

      // Send to GetCourse
      let gcSyncResult: { success: boolean; error?: string; gcOrderId?: string } = { success: false };
      const tariffCode = meta.tariff_code as string | undefined;
      
      if (tariffCode && order.customer_email) {
        console.log(`Sending order to GetCourse: tariff=${tariffCode}, email=${order.customer_email}`);
        
        // Get order_v2 record to retrieve order_number
        const { data: orderV2Data } = await supabase
          .from('orders_v2')
          .select('id, order_number, meta')
          .or(`id.eq.${internalOrderId},meta->>legacy_order_id.eq.${internalOrderId}`)
          .maybeSingle();
        
        const orderV2Id = orderV2Data?.id || internalOrderId;
        const orderNumber = orderV2Data?.order_number || `ORD-LEGACY-${internalOrderId.substring(0, 8)}`;
        const orderV2Meta = (orderV2Data?.meta as Record<string, unknown>) || {};
        
        // Get getcourse_offer_id from tariffs table
        const { data: tariffData } = await supabase
          .from('tariffs')
          .select('getcourse_offer_id')
          .eq('code', tariffCode)
          .maybeSingle();
        
        const getcourseOfferId = tariffData?.getcourse_offer_id;
        
        if (getcourseOfferId) {
          gcSyncResult = await sendToGetCourse(
            {
              email: order.customer_email,
              phone: meta.customer_phone || null,
              firstName: meta.customer_first_name || null,
              lastName: meta.customer_last_name || null,
            },
            getcourseOfferId,
            orderNumber,
            order.amount,
            tariffCode
          );
          
          // Update order with GetCourse sync status
          await supabase
            .from('orders_v2')
            .update({
              meta: {
                ...orderV2Meta,
                gc_sync_status: gcSyncResult.success ? 'success' : 'failed',
                gc_sync_error: gcSyncResult.error || null,
                gc_order_id: gcSyncResult.gcOrderId || null,
                gc_sync_at: new Date().toISOString(),
              },
            })
            .eq('id', orderV2Id);
          
          if (gcSyncResult.success) {
            console.log('GetCourse sync successful');
          } else {
            console.error('GetCourse sync failed:', gcSyncResult.error);
          }
        } else {
          console.log(`No getcourse_offer_id for tariff ${tariffCode}, skipping GetCourse sync`);
        }
      } else {
        console.log('GetCourse sync skipped: no tariff_code or email');
      }

      // Log the action
      await supabase
        .from('audit_logs')
        .insert({
          action: 'payment_completed',
          actor_user_id: order.user_id,
          target_user_id: order.user_id,
          meta: {
            order_id: internalOrderId,
            amount: order.amount,
            currency: order.currency,
            bepaid_uid: transactionUid,
            product_name: product?.name,
            amocrm_contact_id: amoCRMContactId,
            amocrm_deal_id: amoCRMDealId,
            gc_sync_status: gcSyncResult.success ? 'success' : (tariffCode ? 'failed' : 'skipped'),
            gc_order_id: gcSyncResult.gcOrderId,
            bepaid_subscription_id: subscriptionId,
          },
        });

      // Send admin notification email
      if (resend) {
        const priceFormatted = `${(order.amount / 100).toFixed(2)} ${order.currency}`;
        const adminEmail = 'info@ajoure.by';
        
        try {
          await resend.emails.send({
            from: 'Gorbova Club <noreply@gorbova.club>',
            to: [adminEmail],
            subject: `💰 Новая оплата: ${product?.name || 'Подписка'} — ${priceFormatted}`,
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                  .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                  .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
                  .amount { font-size: 24px; font-weight: bold; color: #10b981; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h2 style="margin: 0;">💰 Новая оплата получена!</h2>
                  </div>
                  <div class="content">
                    <p class="amount">${priceFormatted}</p>
                    
                    <div class="info-row">
                      <span>Продукт:</span>
                      <strong>${product?.name || 'Подписка'}</strong>
                    </div>
                    <div class="info-row">
                      <span>Email клиента:</span>
                      <strong>${order.customer_email || '—'}</strong>
                    </div>
                    <div class="info-row">
                      <span>Номер заказа:</span>
                      <span>${internalOrderId}</span>
                    </div>
                    <div class="info-row">
                      <span>ID транзакции:</span>
                      <span>${transactionUid}</span>
                    </div>
                    <div class="info-row">
                      <span>Дата и время:</span>
                      <span>${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}</span>
                    </div>
                    
                    <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
                      Это автоматическое уведомление о новой оплате.
                    </p>
                  </div>
                </div>
              </body>
              </html>
            `,
          });
          console.log('Admin notification email sent');
        } catch (adminEmailError) {
          console.error('Failed to send admin notification:', adminEmailError);
        }
      }

      // Send email notification
      if (resend && order.customer_email) {
        const newUserCreated = meta.new_user_created === true;
        const newUserPassword = meta.new_user_password || null;
        const customerName = meta.customer_first_name 
          ? `${meta.customer_first_name} ${meta.customer_last_name || ''}`.trim()
          : 'Уважаемый клиент';
        const priceFormatted = `${(order.amount / 100).toFixed(2)} ${order.currency}`;

        let emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
              .success-badge { display: inline-block; background: #10b981; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold; margin-bottom: 20px; }
              .order-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
              .order-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
              .order-row:last-child { border-bottom: none; }
              .credentials { background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; }
              .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">Gorbova Club</h1>
                <p style="margin: 10px 0 0;">Подтверждение оплаты</p>
              </div>
              <div class="content">
                <div class="success-badge">✓ Оплата успешна</div>
                
                <p>Здравствуйте, ${customerName}!</p>
                <p>Благодарим вас за покупку. Ваш платёж успешно обработан.</p>
                
                <div class="order-details">
                  <h3 style="margin-top: 0;">Детали заказа</h3>
                  <div class="order-row">
                    <span>Продукт:</span>
                    <strong>${product?.name || 'Подписка'}</strong>
                  </div>
                  <div class="order-row">
                    <span>Сумма:</span>
                    <strong>${priceFormatted}</strong>
                  </div>
                  <div class="order-row">
                    <span>Номер заказа:</span>
                    <span>${orderId}</span>
                  </div>
                  <div class="order-row">
                    <span>ID транзакции:</span>
                    <span>${transactionUid}</span>
                  </div>
                </div>
        `;

        // Add credentials section for new users
        if (newUserCreated && newUserPassword) {
          emailHtml += `
                <div class="credentials">
                  <h3 style="margin-top: 0; color: #92400e;">🔐 Доступ в личный кабинет</h3>
                  <p>Мы создали для вас личный кабинет. Используйте эти данные для входа:</p>
                  <p><strong>Логин (email):</strong> ${order.customer_email}</p>
                  <p><strong>Временный пароль:</strong> ${newUserPassword}</p>
                  <p style="color: #92400e; font-size: 14px;">⚠️ Рекомендуем сменить пароль после первого входа</p>
                </div>
          `;
        }

        emailHtml += `
                <p style="text-align: center; margin-top: 30px;">
                  <a href="https://gorbova.club/dashboard" class="button">Перейти в личный кабинет</a>
                </p>
                
                <div class="footer">
                  <p>Если у вас есть вопросы, свяжитесь с нами по email.</p>
                  <p>© ${new Date().getFullYear()} Gorbova Club. Все права защищены.</p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;

        try {
          const emailResult = await resend.emails.send({
            from: 'Gorbova Club <noreply@gorbova.club>',
            to: [order.customer_email],
            subject: newUserCreated 
              ? 'Добро пожаловать! Данные для входа и подтверждение оплаты' 
              : 'Подтверждение оплаты — Gorbova Club',
            html: emailHtml,
          });
          console.log('Email sent successfully:', emailResult);
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
          // Don't fail the webhook - email is not critical
        }

        // Clear sensitive data from order meta
        if (meta.new_user_password) {
          await supabase
            .from('orders')
            .update({
              meta: {
                ...meta,
                new_user_password: '[REDACTED]',
                email_sent: true,
              }
            })
            .eq('id', orderId);
        }
      }
    }

    // Handle failed payment notification
    if (orderStatus === 'failed' && resend && order.customer_email) {
      const meta = order.meta as Record<string, any> || {};
      const customerName = meta.customer_first_name || 'Уважаемый клиент';

      try {
        await resend.emails.send({
          from: 'Gorbova Club <noreply@gorbova.club>',
          to: [order.customer_email],
          subject: 'Ошибка оплаты — Gorbova Club',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1 style="margin: 0;">Ошибка оплаты</h1>
                </div>
                <div class="content">
                  <p>Здравствуйте, ${customerName}!</p>
                  <p>К сожалению, ваш платёж не был обработан. Это может произойти по следующим причинам:</p>
                  <ul>
                    <li>Недостаточно средств на карте</li>
                    <li>Карта заблокирована или истёк срок действия</li>
                    <li>Превышен лимит на операции</li>
                  </ul>
                  <p>Вы можете попробовать оплатить снова:</p>
                  <p style="text-align: center; margin-top: 20px;">
                    <a href="https://gorbova.club/pricing" class="button">Попробовать снова</a>
                  </p>
                </div>
              </div>
            </body>
            </html>
          `,
        });
        console.log('Failed payment notification sent');
      } catch (emailError) {
        console.error('Failed to send failure email:', emailError);
      }
    }

    console.log(`Order ${orderId} updated to status: ${orderStatus}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
