import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify admin authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin permission
    const { data: hasPermission } = await supabase.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'entitlements.manage',
    });

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { message, include_button, button_text } = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting mass broadcast...');

    // Get all users with active subscriptions and linked Telegram
    const { data: activeUsers, error: usersError } = await supabase
      .from('telegram_access')
      .select(`
        user_id,
        club_id,
        active_until
      `)
      .or('active_until.is.null,active_until.gt.now()');

    if (usersError) {
      console.error('Error fetching active users:', usersError);
      throw usersError;
    }

    console.log(`Found ${activeUsers?.length || 0} active telegram access records`);

    // Get unique user IDs
    const uniqueUserIds = [...new Set(activeUsers?.map(u => u.user_id) || [])];
    console.log(`Unique users: ${uniqueUserIds.length}`);

    // Get profiles with Telegram IDs
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, telegram_user_id, full_name')
      .in('user_id', uniqueUserIds)
      .not('telegram_user_id', 'is', null);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      throw profilesError;
    }

    console.log(`Found ${profiles?.length || 0} profiles with Telegram`);

    // Get first available bot token
    const { data: bots, error: botsError } = await supabase
      .from('telegram_bots')
      .select('bot_token_encrypted')
      .eq('status', 'active')
      .limit(1);

    if (botsError || !bots?.length) {
      console.error('No active bot found');
      return new Response(
        JSON.stringify({ error: 'No active bot found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const botToken = bots[0].bot_token_encrypted;
    const appUrl = Deno.env.get('APP_URL') || 'https://app.example.com';

    let sent = 0;
    let failed = 0;

    // Send messages
    for (const profile of profiles || []) {
      try {
        const keyboard = include_button ? {
          inline_keyboard: [[
            { text: button_text || 'Открыть платформу', url: appUrl }
          ]]
        } : undefined;

        const result = await telegramRequest(botToken, 'sendMessage', {
          chat_id: profile.telegram_user_id,
          text: message,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });

        if (result.ok) {
          sent++;
          console.log(`Message sent to user ${profile.user_id}`);
        } else {
          failed++;
          console.error(`Failed to send to ${profile.user_id}:`, result.description);
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        failed++;
        console.error(`Error sending to ${profile.user_id}:`, error);
      }
    }

    // Log the broadcast action
    await supabase.from('telegram_logs').insert({
      action: 'MASS_NOTIFICATION',
      target: `${sent}/${sent + failed} users`,
      status: failed === 0 ? 'ok' : 'partial',
      meta: {
        message_preview: message.substring(0, 100),
        total_users: sent + failed,
        sent,
        failed,
      },
    });

    // Log to audit_logs
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'telegram_mass_broadcast',
      meta: {
        sent,
        failed,
        total: sent + failed,
        message_preview: message.substring(0, 50),
      },
    });

    console.log(`Broadcast complete: sent=${sent}, failed=${failed}`);

    return new Response(
      JSON.stringify({ success: true, sent, failed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Mass broadcast error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
