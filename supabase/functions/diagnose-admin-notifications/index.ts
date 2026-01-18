import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DiagnoseRequest {
  order_id?: string;
  order_number?: string;
  dry_run?: boolean; // true = just show what would be sent, don't actually send
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - require admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', { _user_id: user.id });
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: super_admin only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { order_id, order_number, dry_run = true }: DiagnoseRequest = await req.json();

    const diagnostics: Record<string, any> = {
      timestamp: new Date().toISOString(),
      request: { order_id, order_number, dry_run },
      steps: [],
    };

    // Step 1: Find order
    let order: any = null;
    if (order_id) {
      const { data, error } = await supabase
        .from('orders_v2')
        .select(`
          id, order_number, status, customer_email, customer_phone, user_id, profile_id,
          product_id, tariff_id, paid_amount, currency, is_trial, created_at,
          products_v2:product_id(name),
          tariffs:tariff_id(name)
        `)
        .eq('id', order_id)
        .single();
      if (error) diagnostics.steps.push({ step: 'find_order_by_id', error: error.message });
      else order = data;
    } else if (order_number) {
      const { data, error } = await supabase
        .from('orders_v2')
        .select(`
          id, order_number, status, customer_email, customer_phone, user_id, profile_id,
          product_id, tariff_id, paid_amount, currency, is_trial, created_at,
          products_v2:product_id(name),
          tariffs:tariff_id(name)
        `)
        .eq('order_number', order_number)
        .single();
      if (error) diagnostics.steps.push({ step: 'find_order_by_number', error: error.message });
      else order = data;
    }

    if (!order) {
      diagnostics.steps.push({ step: 'find_order', result: 'NOT_FOUND' });
      return new Response(JSON.stringify({ success: false, diagnostics }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    diagnostics.order = {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      customer_email: order.customer_email,
      product: (order.products_v2 as any)?.name,
      tariff: (order.tariffs as any)?.name,
      paid_amount: order.paid_amount,
      is_trial: order.is_trial,
    };
    diagnostics.steps.push({ step: 'find_order', result: 'OK' });

    // Step 2: Get customer profile
    let customerProfile: any = null;
    if (order.user_id) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, telegram_username')
        .eq('user_id', order.user_id)
        .single();
      customerProfile = data;
    } else if (order.profile_id) {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, telegram_username')
        .eq('id', order.profile_id)
        .single();
      customerProfile = data;
    }
    diagnostics.customer_profile = customerProfile || { warning: 'No profile found' };
    diagnostics.steps.push({ step: 'get_customer_profile', result: customerProfile ? 'OK' : 'NOT_FOUND' });

    // Step 3: Check super_admin recipients
    const { data: adminRoles } = await supabase
      .from('roles')
      .select('id')
      .eq('code', 'super_admin');

    if (!adminRoles || adminRoles.length === 0) {
      diagnostics.steps.push({ step: 'get_admin_roles', result: 'NO_SUPER_ADMIN_ROLE_DEFINED' });
      return new Response(JSON.stringify({ success: false, diagnostics }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    diagnostics.steps.push({ step: 'get_admin_roles', result: 'OK', role_ids: adminRoles.map((r: any) => r.id) });

    const { data: adminUserRoles } = await supabase
      .from('user_roles_v2')
      .select('user_id')
      .in('role_id', adminRoles.map((r: any) => r.id));

    if (!adminUserRoles || adminUserRoles.length === 0) {
      diagnostics.steps.push({ step: 'get_admin_users', result: 'NO_USERS_WITH_SUPER_ADMIN' });
      return new Response(JSON.stringify({ success: false, diagnostics }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    diagnostics.steps.push({ step: 'get_admin_users', result: 'OK', count: adminUserRoles.length });

    const { data: adminProfiles } = await supabase
      .from('profiles')
      .select('user_id, telegram_user_id, telegram_link_bot_id, full_name, email')
      .in('user_id', adminUserRoles.map((ur: any) => ur.user_id));

    const adminsWithTelegram = (adminProfiles || []).filter((p: any) => p.telegram_user_id);
    diagnostics.admin_recipients = {
      total_super_admins: adminProfiles?.length || 0,
      with_telegram: adminsWithTelegram.length,
      details: adminsWithTelegram.map((a: any) => ({
        name: a.full_name,
        email: a.email,
        telegram_user_id: a.telegram_user_id,
        linked_bot_id: a.telegram_link_bot_id,
      })),
    };
    diagnostics.steps.push({ step: 'get_admin_recipients', result: adminsWithTelegram.length > 0 ? 'OK' : 'NO_TELEGRAM_LINKED' });

    // Step 4: Check telegram bots
    const { data: bots } = await supabase
      .from('telegram_bots')
      .select('id, bot_name, is_primary, status')
      .eq('status', 'active');

    diagnostics.telegram_bots = {
      active_count: bots?.length || 0,
      bots: bots?.map((b: any) => ({ id: b.id, name: b.bot_name, is_primary: b.is_primary })) || [],
    };
    diagnostics.steps.push({ step: 'get_telegram_bots', result: (bots?.length || 0) > 0 ? 'OK' : 'NO_ACTIVE_BOTS' });

    // Step 5: Build message
    const amountFormatted = Number(order.paid_amount || 0).toFixed(2);
    const paymentType = order.is_trial ? '🔔 Пробный период' : '💰 Оплата';
    const productName = (order.products_v2 as any)?.name || 'N/A';
    const tariffName = (order.tariffs as any)?.name || 'N/A';

    const notifyMessage = `${paymentType}\n\n` +
      `👤 <b>Клиент:</b> ${customerProfile?.full_name || 'Не указано'}\n` +
      `📧 Email: ${customerProfile?.email || order.customer_email || 'Не указан'}\n` +
      `📱 Телефон: ${customerProfile?.phone || order.customer_phone || 'Не указан'}\n` +
      (customerProfile?.telegram_username ? `💬 Telegram: @${customerProfile.telegram_username}\n` : '') +
      `\n📦 <b>Продукт:</b> ${productName}\n` +
      `📋 Тариф: ${tariffName}\n` +
      `💵 Сумма: ${amountFormatted} ${order.currency || 'BYN'}\n` +
      `🆔 Заказ: ${order.order_number}`;

    diagnostics.message = notifyMessage;
    diagnostics.steps.push({ step: 'build_message', result: 'OK' });

    // Step 6: Check existing notifications for this order
    const { data: existingLogs } = await supabase
      .from('telegram_logs')
      .select('id, action, status, created_at, meta')
      .or(`meta->order_id.eq.${order.id},meta->order_number.eq.${order.order_number}`)
      .order('created_at', { ascending: false })
      .limit(10);

    diagnostics.existing_notifications = existingLogs || [];
    diagnostics.steps.push({ 
      step: 'check_existing_notifications', 
      result: (existingLogs?.length || 0) > 0 ? 'FOUND' : 'NONE',
      count: existingLogs?.length || 0,
    });

    // Step 7: Send or dry-run
    if (dry_run) {
      diagnostics.steps.push({ step: 'notification', result: 'DRY_RUN_SKIPPED' });
      diagnostics.would_send_to = adminsWithTelegram.map((a: any) => a.full_name);
    } else if (adminsWithTelegram.length === 0 || (bots?.length || 0) === 0) {
      diagnostics.steps.push({ step: 'notification', result: 'SKIPPED_NO_RECIPIENTS_OR_BOTS' });
    } else {
      // Use fetch instead of supabase.functions.invoke (cross-function invoke has issues)
      try {
        const notifyResponse = await fetch(
          `${supabaseUrl}/functions/v1/telegram-notify-admins`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              message: notifyMessage,
              source: 'diagnostic_test',
              order_id: order.id,
              order_number: order.order_number,
            }),
          }
        );

        const notifyResult = await notifyResponse.json();

        if (!notifyResponse.ok) {
          diagnostics.steps.push({ step: 'notification', result: 'FETCH_ERROR', status: notifyResponse.status, error: notifyResult });
        } else {
          diagnostics.steps.push({ step: 'notification', result: 'SENT', response: notifyResult });
        }
      } catch (fetchError) {
        diagnostics.steps.push({ step: 'notification', result: 'FETCH_EXCEPTION', error: (fetchError as Error).message });
      }
    }

    // Log this diagnostic run
    await supabase.from('telegram_logs').insert({
      action: 'ADMIN_NOTIFY_DIAGNOSTIC',
      status: 'info',
      meta: {
        order_id: order.id,
        order_number: order.order_number,
        dry_run,
        admin_count: adminsWithTelegram.length,
        bot_count: bots?.length || 0,
        invoked_by: user.id,
      },
    });

    return new Response(JSON.stringify({ 
      success: true, 
      diagnostics,
      summary: {
        order_found: !!order,
        customer_found: !!customerProfile,
        admin_recipients: adminsWithTelegram.length,
        active_bots: bots?.length || 0,
        dry_run,
        can_send: adminsWithTelegram.length > 0 && (bots?.length || 0) > 0,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in diagnose-admin-notifications:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
