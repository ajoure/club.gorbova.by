import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotifyRequest {
  message: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
  // Optional tracking fields for diagnostics
  source?: string;
  order_id?: string;
  order_number?: string;
  payment_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Optionally verify caller is admin (skip for internal calls with service role key)
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      
      // Skip auth check if it's the service role key (internal call from other edge functions)
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (token !== serviceRoleKey) {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        
        if (authError || !user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check if caller has admin permission
        const { data: hasPermission } = await supabase.rpc('has_permission', {
          _user_id: user.id,
          _permission_code: 'entitlements.manage',
        });

        if (!hasPermission) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      // If token === serviceRoleKey, allow the request (internal call)
    }

    const { message, parse_mode = 'HTML', source, order_id, order_number, payment_id }: NotifyRequest = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: 'message required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[telegram-notify-admins] Starting notification, source=${source || 'unknown'}, order=${order_number || order_id || 'N/A'}`);

    // =================================================================
    // PATCH 13D: RBAC - super_admin + admin with deals.edit permission
    // =================================================================
    
    // 1. Get super_admin role ID
    const { data: superAdminRoles } = await supabase
      .from('roles')
      .select('id')
      .eq('code', 'super_admin');

    const superAdminRoleIds = superAdminRoles?.map((r: any) => r.id) || [];

    // 2. Get users with super_admin role
    let superAdminUserIds: string[] = [];
    if (superAdminRoleIds.length > 0) {
      const { data: superAdminUsers } = await supabase
        .from('user_roles_v2')
        .select('user_id')
        .in('role_id', superAdminRoleIds);
      superAdminUserIds = superAdminUsers?.map((ur: any) => ur.user_id) || [];
    }

    // 3. Get admins with deals.edit permission via RPC
    const { data: adminsWithDealsEdit } = await supabase.rpc('find_users_with_permission', {
      permission_code: 'deals.edit'
    });
    const dealsEditUserIds = adminsWithDealsEdit?.map((u: any) => u.user_id) || [];

    // 4. Combine and deduplicate
    const allEligibleUserIds = [...new Set([...superAdminUserIds, ...dealsEditUserIds])];

    if (allEligibleUserIds.length === 0) {
      console.log('No eligible admins found (super_admin or deals.edit)');
      await supabase.from('telegram_logs').insert({
        action: 'ADMIN_NOTIFY_SKIPPED',
        status: 'info',
        meta: { 
          reason: 'no_eligible_admins', 
          super_admins: superAdminUserIds.length,
          deals_edit_admins: dealsEditUserIds.length,
          source, order_id, order_number, payment_id 
        },
      });
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no_eligible_admins' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${allEligibleUserIds.length} eligible admins (${superAdminUserIds.length} super_admin + ${dealsEditUserIds.length} with deals.edit)`);

    // Get admin profiles with telegram info
    const { data: adminProfiles } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_link_bot_id, full_name')
      .in('user_id', allEligibleUserIds)
      .not('telegram_user_id', 'is', null);

    if (!adminProfiles || adminProfiles.length === 0) {
      console.log('No eligible admins with Telegram linked');
      await supabase.from('telegram_logs').insert({
        action: 'ADMIN_NOTIFY_SKIPPED',
        status: 'info',
        meta: { reason: 'no_telegram_linked', admin_count: allEligibleUserIds.length, source, order_id, order_number, payment_id },
      });
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no_telegram_linked' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all active bots
    const { data: bots } = await supabase
      .from('telegram_bots')
      .select('id, bot_token_encrypted, is_primary')
      .eq('status', 'active');

    if (!bots || bots.length === 0) {
      console.warn('No active telegram bots');
      await supabase.from('telegram_logs').insert({
        action: 'ADMIN_NOTIFY_FAILED',
        status: 'error',
        meta: { reason: 'no_active_bots', source, order_id, order_number, payment_id },
      });
      return new Response(JSON.stringify({ success: false, error: 'no_active_bots' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build bot token lookup
    const botsById = new Map<string, string>();
    for (const b of bots as any[]) {
      if (b?.id && b?.bot_token_encrypted) {
        botsById.set(b.id, b.bot_token_encrypted);
      }
    }

    // Get primary or first available bot
    const primaryBot = (bots as any[]).sort((a, b) => (b?.is_primary ? 1 : 0) - (a?.is_primary ? 1 : 0))[0];
    const fallbackToken = primaryBot?.bot_token_encrypted || Array.from(botsById.values())[0];

    let sentCount = 0;
    const errors: string[] = [];

    for (const admin of adminProfiles as any[]) {
      // Use admin's linked bot if available, otherwise fallback
      const botToken = (admin?.telegram_link_bot_id && botsById.get(admin.telegram_link_bot_id))
        ? botsById.get(admin.telegram_link_bot_id)
        : fallbackToken;

      if (!botToken) continue;

      try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: admin.telegram_user_id,
            text: message,
            parse_mode,
          }),
        });

        const result = await resp.json().catch(() => ({}));

        if (resp.ok && result?.ok) {
          sentCount++;
          console.log(`✅ Sent to ${admin.full_name} (TG: ${admin.telegram_user_id})`);
        } else {
          const errorDesc = result?.description || `HTTP ${resp.status}`;
          console.error(`❌ Failed for ${admin.full_name} (TG: ${admin.telegram_user_id}):`, errorDesc);
          errors.push(`${admin.full_name}: ${errorDesc}`);
          
          // Log to telegram_logs for audit
          await supabase.from('telegram_logs').insert({
            action: 'ADMIN_NOTIFY_FAILED',
            status: 'error',
            meta: { 
              admin_name: admin.full_name,
              telegram_user_id: admin.telegram_user_id,
              error: errorDesc,
              source,
              order_id,
              order_number,
              payment_id,
              hint: errorDesc.includes("can't initiate") 
                ? 'Админ должен отправить /start боту для получения уведомлений'
                : null,
            },
          });
        }
      } catch (err) {
        console.error('Failed to notify admin:', admin.full_name, err);
        errors.push(`${admin.full_name}: ${(err as Error).message}`);
      }
    }

    console.log(`Notified ${sentCount}/${adminProfiles.length} eligible admins (super_admin + deals.edit), source=${source || 'unknown'}`);

    // Log success summary
    await supabase.from('telegram_logs').insert({
      action: 'ADMIN_NOTIFY_SENT',
      status: sentCount > 0 ? 'success' : 'warning',
      meta: { 
        sent: sentCount, 
        total: adminProfiles.length,
        source,
        order_id,
        order_number,
        payment_id,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return new Response(JSON.stringify({ 
      success: true, 
      sent: sentCount, 
      total: adminProfiles.length,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in telegram-notify-admins:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});