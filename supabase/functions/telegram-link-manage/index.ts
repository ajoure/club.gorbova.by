import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  action: 'start' | 'unlink' | 'check_status' | 'cancel';
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Admin client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Auth client for token validation
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log('[telegram-link-manage] No auth header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    console.log('[telegram-link-manage] Validating token...');
    
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      console.log('[telegram-link-manage] Auth error:', authError?.message || 'No user');
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action } = await req.json() as RequestBody;
    console.log(`[telegram-link-manage] Action: ${action}, User: ${user.id}`);

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, telegram_user_id, telegram_username, telegram_linked_at, telegram_link_status, telegram_link_bot_id, telegram_last_check_at')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      console.error('[telegram-link-manage] Profile error:', profileError);
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get primary bot
    const { data: primaryBot } = await supabase
      .from('telegram_bots')
      .select('id, bot_username, bot_name, status')
      .eq('is_primary', true)
      .eq('status', 'active')
      .single();

    // Fallback to first active bot if no primary
    let bot = primaryBot;
    if (!bot) {
      const { data: fallbackBot } = await supabase
        .from('telegram_bots')
        .select('id, bot_username, bot_name, status')
        .eq('status', 'active')
        .limit(1)
        .single();
      bot = fallbackBot;
    }

    switch (action) {
      case 'start': {
        if (!bot) {
          return new Response(
            JSON.stringify({ error: 'No active bot configured' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Cancel any pending sessions
        await supabase
          .from('telegram_link_tokens')
          .update({ status: 'cancelled' })
          .eq('user_id', user.id)
          .eq('status', 'pending');

        // Generate new token
        const linkToken = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        const actionType = profile.telegram_user_id ? 'relink' : 'link';

        const { error: tokenError } = await supabase
          .from('telegram_link_tokens')
          .insert({
            user_id: user.id,
            token: linkToken,
            expires_at: expiresAt.toISOString(),
            status: 'pending',
            bot_id: bot.id,
            action_type: actionType,
          });

        if (tokenError) {
          console.error('[telegram-link-manage] Token error:', tokenError);
          return new Response(
            JSON.stringify({ error: 'Failed to create link session' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update profile status to pending
        await supabase
          .from('profiles')
          .update({ 
            telegram_link_status: 'pending',
            telegram_link_bot_id: bot.id,
          })
          .eq('user_id', user.id);

        // Log to audit
        await supabase.from('telegram_access_audit').insert({
          user_id: user.id,
          event_type: 'telegram_link_started',
          actor_type: 'user',
          actor_id: user.id,
          meta: { action_type: actionType, bot_username: bot.bot_username },
        });

        console.log(`[telegram-link-manage] Link session created for user ${user.id}, token: ${linkToken.slice(0,4)}...`);

        return new Response(
          JSON.stringify({
            success: true,
            token: linkToken,
            bot_username: bot.bot_username,
            deep_link: `https://t.me/${bot.bot_username}?start=${linkToken}`,
            expires_at: expiresAt.toISOString(),
            action_type: actionType,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'unlink': {
        if (!profile.telegram_user_id) {
          return new Response(
            JSON.stringify({ error: 'Telegram not linked' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const oldTelegramId = profile.telegram_user_id;
        const oldUsername = profile.telegram_username;

        // Clear telegram data from profile
        const { error: unlinkError } = await supabase
          .from('profiles')
          .update({
            telegram_user_id: null,
            telegram_username: null,
            telegram_linked_at: null,
            telegram_link_status: 'not_linked',
            telegram_link_bot_id: null,
            telegram_last_check_at: null,
            telegram_last_error: null,
          })
          .eq('user_id', user.id);

        if (unlinkError) {
          console.error('[telegram-link-manage] Unlink error:', unlinkError);
          return new Response(
            JSON.stringify({ error: 'Failed to unlink' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Log to audit
        await supabase.from('telegram_access_audit').insert({
          user_id: user.id,
          telegram_user_id: oldTelegramId,
          event_type: 'telegram_unlink',
          actor_type: 'user',
          actor_id: user.id,
          meta: { old_username: oldUsername },
        });

        // Log to telegram_logs
        await supabase.from('telegram_logs').insert({
          user_id: user.id,
          action: 'UNLINK',
          target: 'profile',
          status: 'ok',
          meta: { telegram_user_id: oldTelegramId, telegram_username: oldUsername },
        });

        console.log(`[telegram-link-manage] User ${user.id} unlinked Telegram ${oldTelegramId}`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check_status': {
        if (!profile.telegram_user_id) {
          return new Response(
            JSON.stringify({
              status: 'not_linked',
              needs_action: false,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if we should skip (throttle to once per hour)
        const lastCheck = profile.telegram_last_check_at ? new Date(profile.telegram_last_check_at) : null;
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        
        if (lastCheck && lastCheck > oneHourAgo) {
          // Return cached status
          return new Response(
            JSON.stringify({
              status: profile.telegram_link_status,
              telegram_username: profile.telegram_username,
              telegram_id_masked: `****${String(profile.telegram_user_id).slice(-4)}`,
              linked_at: profile.telegram_linked_at,
              last_check_at: profile.telegram_last_check_at,
              needs_action: profile.telegram_link_status === 'inactive',
              cached: true,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Try to send a test message to check if bot can reach user
        let canReach = false;
        let checkError: string | null = null;

        if (bot) {
          try {
            // Get bot token
            const { data: botData } = await supabase
              .from('telegram_bots')
              .select('bot_token_encrypted')
              .eq('id', profile.telegram_link_bot_id || bot.id)
              .single();

            if (botData?.bot_token_encrypted) {
              // Try getChat to check if user hasn't blocked the bot
              const response = await fetch(
                `https://api.telegram.org/bot${botData.bot_token_encrypted}/getChat`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: profile.telegram_user_id }),
                }
              );
              const result = await response.json();
              
              if (result.ok) {
                canReach = true;
              } else {
                checkError = result.description || 'Unknown error';
                console.log(`[telegram-link-manage] Cannot reach user: ${checkError}`);
              }
            }
          } catch (e) {
            checkError = e instanceof Error ? e.message : 'Check failed';
            console.error('[telegram-link-manage] Check error:', e);
          }
        }

        const newStatus = canReach ? 'active' : 'inactive';

        // Update profile with check result
        await supabase
          .from('profiles')
          .update({
            telegram_link_status: newStatus,
            telegram_last_check_at: now.toISOString(),
            telegram_last_error: checkError,
          })
          .eq('user_id', user.id);

        // Log to audit
        await supabase.from('telegram_access_audit').insert({
          user_id: user.id,
          telegram_user_id: profile.telegram_user_id,
          event_type: 'telegram_status_check',
          actor_type: 'user',
          actor_id: user.id,
          meta: { result: newStatus, error: checkError },
        });

        console.log(`[telegram-link-manage] Status check for user ${user.id}: ${newStatus}`);

        return new Response(
          JSON.stringify({
            status: newStatus,
            telegram_username: profile.telegram_username,
            telegram_id_masked: `****${String(profile.telegram_user_id).slice(-4)}`,
            linked_at: profile.telegram_linked_at,
            last_check_at: now.toISOString(),
            needs_action: newStatus === 'inactive',
            error: checkError,
            cached: false,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'cancel': {
        // Cancel pending link session
        await supabase
          .from('telegram_link_tokens')
          .update({ status: 'cancelled' })
          .eq('user_id', user.id)
          .eq('status', 'pending');

        // Reset status if was pending
        if (profile.telegram_link_status === 'pending') {
          await supabase
            .from('profiles')
            .update({
              telegram_link_status: profile.telegram_user_id ? 'active' : 'not_linked',
            })
            .eq('user_id', user.id);
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[telegram-link-manage] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
