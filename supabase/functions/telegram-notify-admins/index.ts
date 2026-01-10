import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotifyRequest {
  message: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Optionally verify caller is admin (skip for internal calls without auth header)
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
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

    const { message, parse_mode = 'HTML' }: NotifyRequest = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: 'message required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get only super_admin role ID (not regular admins)
    const { data: adminRoles } = await supabase
      .from('roles')
      .select('id')
      .eq('code', 'super_admin');

    if (!adminRoles || adminRoles.length === 0) {
      console.log('No admin roles defined in system');
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no_admin_roles' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminRoleIds = adminRoles.map((r: any) => r.id);

    // Get user_ids with admin roles
    const { data: adminUserRoles } = await supabase
      .from('user_roles_v2')
      .select('user_id')
      .in('role_id', adminRoleIds);

    if (!adminUserRoles || adminUserRoles.length === 0) {
      console.log('No users with admin roles found');
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no_super_admins' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const superAdminUserIds = adminUserRoles.map((ur: any) => ur.user_id);
    console.log(`Found ${superAdminUserIds.length} admin users to notify`);

    // Get admin profiles with telegram info
    const { data: adminProfiles } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_link_bot_id, full_name')
      .in('user_id', superAdminUserIds)
      .not('telegram_user_id', 'is', null);

    if (!adminProfiles || adminProfiles.length === 0) {
      console.log('No super admins with Telegram linked');
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

    console.log(`Notified ${sentCount}/${adminProfiles.length} super admins`);

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
