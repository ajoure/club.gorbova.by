import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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


Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resend = resendApiKey ? new Resend(resendApiKey) : null;

    const body = await req.json();
    console.log('bePaid webhook received:', JSON.stringify(body, null, 2));

    const transaction = body.transaction;
    if (!transaction) {
      console.error('No transaction in webhook payload');
      return new Response(
        JSON.stringify({ error: 'Invalid payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orderId = transaction.tracking_id;
    const transactionStatus = transaction.status;
    const transactionUid = transaction.uid;
    const paymentMethod = transaction.payment_method_type;

    console.log(`Processing transaction: ${transactionUid}, status: ${transactionStatus}, order: ${orderId}`);

    if (!orderId) {
      console.error('No tracking_id (order ID) in transaction');
      return new Response(
        JSON.stringify({ error: 'Missing tracking_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, products(*)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderId, orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map bePaid status to our status
    let orderStatus = order.status;
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

    // Update order
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: orderStatus,
        bepaid_uid: transactionUid,
        payment_method: paymentMethod,
        error_message: transaction.message || null,
        meta: {
          ...order.meta,
          bepaid_response: transaction,
        },
      })
      .eq('id', orderId);

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
            console.log(`Duplicate detected for order ${orderId}, case: ${duplicateResult.data.caseId}`);
            await supabase
              .from('orders')
              .update({
                possible_duplicate: true,
                duplicate_reason: `Дубль по телефону: ${duplicateResult.data.duplicates?.length || 0} профилей`,
              })
              .eq('id', orderId);
          }
        } catch (dupError) {
          console.error('Error detecting duplicates:', dupError);
        }
      }
      
      if (product) {
        console.log(`Granting entitlement for product: ${product.name}`);

        // Calculate expiration date
        let expiresAt = null;
        if (product.duration_days) {
          expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + product.duration_days);
        }

        // Create or update entitlement
        const { error: entitlementError } = await supabase
          .from('entitlements')
          .upsert({
            user_id: order.user_id,
            product_code: product.product_type === 'subscription' ? (product.tier || 'pro') : product.id,
            status: 'active',
            expires_at: expiresAt?.toISOString() || null,
            meta: {
              order_id: orderId,
              product_name: product.name,
              bepaid_uid: transactionUid,
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
          order_id: orderId,
          product: product?.name,
          subscription_tier: product?.tier,
        }
      );

      // Log the action
      await supabase
        .from('audit_logs')
        .insert({
          action: 'payment_completed',
          actor_user_id: order.user_id,
          target_user_id: order.user_id,
          meta: {
            order_id: orderId,
            amount: order.amount,
            currency: order.currency,
            bepaid_uid: transactionUid,
            product_name: product?.name,
            amocrm_contact_id: amoCRMContactId,
            amocrm_deal_id: amoCRMDealId,
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
                      <span>${orderId}</span>
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
