import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send order to GetCourse
// Now uses getcourse_offer_id from tariffs table instead of hardcoded mapping
async function sendToGetCourse(
  email: string,
  phone: string | null,
  offerId: number,
  orderId: string,
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
    console.log(`Sending order to GetCourse: email=${email}, offerId=${offerId}, orderId=${orderId}`);
    
    // GetCourse API expects form-encoded data with action and params
    const params = {
      user: {
        email: email,
        phone: phone || undefined,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        offer_code: offerId.toString(),
        deal_number: orderId,
        deal_cost: amount / 100, // Convert from kopecks
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Оплата через сайт club.gorbova.by. Order ID: ${orderId}`,
      },
    };
    
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
    
    if (data.success || data.result?.success) {
      console.log('Order successfully sent to GetCourse');
      return { success: true, gcOrderId: data.result?.deal_id?.toString() };
    } else {
      const errorMsg = data.error_message || data.result?.error_message || 'Unknown error';
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
    
    // Verify webhook signature if secret is configured
    if (bepaidSecretKey) {
      const signature = req.headers.get('X-Webhook-Signature') || 
                       req.headers.get('Authorization')?.replace('Bearer ', '') || null;
      
      const isValid = await verifyWebhookSignature(bodyText, signature, bepaidSecretKey);
      
      if (!isValid) {
        console.error('Invalid bePaid webhook signature');
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('bePaid webhook signature verified successfully');
    } else {
      console.warn('BEPAID_SECRET_KEY not configured - webhook signature verification skipped');
    }

    const body = JSON.parse(bodyText);
    console.log('bePaid webhook received:', JSON.stringify(body, null, 2));

    const subscription = body.subscription || null;
    // bePaid can send either transaction webhooks or subscription webhooks
    const transaction = body.transaction || subscription?.last_transaction || null;

    const orderId = transaction?.tracking_id || subscription?.tracking_id || null;
    const transactionStatus = transaction?.status || null;
    const transactionUid = transaction?.uid || null;
    const paymentMethod = transaction?.payment_method_type || transaction?.payment_method || null;
    const subscriptionId = subscription?.id || null;

    console.log(`Processing bePaid webhook: order=${orderId}, transaction=${transactionUid}, status=${transactionStatus}, subscription=${subscriptionId}`);

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
    } else if (subscription?.state) {
      // Subscription webhooks might not include transaction object
      if (subscription.state === 'active') orderStatus = 'completed';
      else if (subscription.state === 'failed' || subscription.state === 'canceled') orderStatus = 'failed';
      else orderStatus = 'processing';
    } else {
      orderStatus = 'processing';
    }

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
      const product = order.products;
      const meta = order.meta as Record<string, any> || {};
      
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
      
      const amoCRMContactId = await createAmoCRMContact(
        customerName,
        order.customer_email || '',
        meta.customer_phone
      );

      const amoCRMDealId = await createAmoCRMDeal(
        `Оплата: ${product?.name || 'Подписка'}`,
        order.amount / 100, // Convert from kopecks to rubles
        amoCRMContactId,
        {
          order_id: internalOrderId,
          product: product?.name,
          subscription_tier: product?.tier,
        }
      );

      // Send to GetCourse
      let gcSyncResult: { success: boolean; error?: string; gcOrderId?: string } = { success: false };
      const tariffCode = meta.tariff_code as string | undefined;
      
      if (tariffCode && order.customer_email) {
        console.log(`Sending order to GetCourse: tariff=${tariffCode}, email=${order.customer_email}`);
        
        // Get getcourse_offer_id from tariffs table
        const { data: tariffData } = await supabase
          .from('tariffs')
          .select('getcourse_offer_id')
          .eq('code', tariffCode)
          .maybeSingle();
        
        const getcourseOfferId = tariffData?.getcourse_offer_id;
        
        if (getcourseOfferId) {
          gcSyncResult = await sendToGetCourse(
            order.customer_email,
            meta.customer_phone || null,
            getcourseOfferId,
            internalOrderId,
            order.amount,
            tariffCode
          );
          
          // Update order with GetCourse sync status
          await supabase
            .from('orders')
            .update({
              meta: {
                ...meta,
                gc_sync_status: gcSyncResult.success ? 'success' : 'failed',
                gc_sync_error: gcSyncResult.error || null,
                gc_order_id: gcSyncResult.gcOrderId || null,
                gc_sync_at: new Date().toISOString(),
              },
            })
            .eq('id', internalOrderId);
          
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
