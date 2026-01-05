import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BotAction {
  action: 'check_connection' | 'set_webhook' | 'delete_webhook' | 'get_me' | 'check_chat_rights';
  bot_id?: string;
  bot_token?: string;
  chat_id?: number;
  channel_id?: number;
}

// Telegram API helper
async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const options: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (params) {
    options.body = JSON.stringify(params);
  }
  const response = await fetch(url, options);
  return response.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
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

    // Check permissions
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

    const body: BotAction = await req.json();
    const { action, bot_id, bot_token: providedToken, chat_id, channel_id } = body;

    let botToken = providedToken;

    // Get bot token from database if bot_id provided
    if (bot_id && !botToken) {
      const { data: bot, error: botError } = await supabase
        .from('telegram_bots')
        .select('bot_token_encrypted')
        .eq('id', bot_id)
        .single();

      if (botError || !bot) {
        return new Response(JSON.stringify({ error: 'Bot not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      botToken = bot.bot_token_encrypted;
    }

    if (!botToken) {
      return new Response(JSON.stringify({ error: 'Bot token required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    switch (action) {
      case 'get_me':
      case 'check_connection': {
        const result = await telegramRequest(botToken, 'getMe');
        
        if (result.ok) {
          // Update bot record if bot_id provided
          if (bot_id) {
            await supabase
              .from('telegram_bots')
              .update({
                bot_id: result.result.id,
                last_check_at: new Date().toISOString(),
                error_message: null,
              })
              .eq('id', bot_id);
          }
          
          // Log admin action
          await supabase.from('audit_logs').insert({
            action: 'telegram_bot_check',
            actor_user_id: user.id,
            meta: {
              bot_id,
              action: 'check_connection',
              result: 'success',
              bot_username: result.result.username,
            },
          });
          
          return new Response(JSON.stringify({
            success: true,
            bot: result.result,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else {
          // Update error if bot_id provided
          if (bot_id) {
            await supabase
              .from('telegram_bots')
              .update({
                last_check_at: new Date().toISOString(),
                error_message: result.description || 'Unknown error',
              })
              .eq('id', bot_id);
          }
          
          // Log admin action
          await supabase.from('audit_logs').insert({
            action: 'telegram_bot_check',
            actor_user_id: user.id,
            meta: {
              bot_id,
              action: 'check_connection',
              result: 'error',
              error: result.description,
            },
          });
          
          return new Response(JSON.stringify({
            success: false,
            error: result.description || 'Failed to connect to Telegram',
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      case 'set_webhook': {
        if (!bot_id) {
          return new Response(JSON.stringify({ error: 'bot_id required for webhook setup' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const webhookUrl = `${supabaseUrl}/functions/v1/telegram-webhook?bot_id=${bot_id}`;
        const result = await telegramRequest(botToken, 'setWebhook', {
          url: webhookUrl,
          allowed_updates: ['message', 'my_chat_member', 'callback_query'],
        });

        // Log admin action
        await supabase.from('audit_logs').insert({
          action: 'telegram_webhook_set',
          actor_user_id: user.id,
          meta: {
            bot_id,
            webhook_url: webhookUrl,
            result: result.ok ? 'success' : 'error',
          },
        });

        return new Response(JSON.stringify({
          success: result.ok,
          webhook_url: webhookUrl,
          result,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete_webhook': {
        const result = await telegramRequest(botToken, 'deleteWebhook');
        
        // Log admin action
        await supabase.from('audit_logs').insert({
          action: 'telegram_webhook_delete',
          actor_user_id: user.id,
          meta: {
            bot_id,
            result: result.ok ? 'success' : 'error',
          },
        });
        
        return new Response(JSON.stringify({
          success: result.ok,
          result,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_chat_rights': {
        if (!chat_id && !channel_id) {
          return new Response(JSON.stringify({ error: 'chat_id or channel_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get bot info first
        const meResult = await telegramRequest(botToken, 'getMe');
        if (!meResult.ok) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Failed to get bot info: ' + (meResult.description || 'Unknown error'),
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const botUserId = meResult.result.id;
        const results: { chat?: any; channel?: any } = {};

        // Check chat rights
        if (chat_id) {
          const memberResult = await telegramRequest(botToken, 'getChatMember', {
            chat_id,
            user_id: botUserId,
          });

          if (!memberResult.ok) {
            results.chat = {
              success: false,
              error: memberResult.description || 'Failed to check chat member',
              is_member: false,
              is_admin: false,
              can_invite_users: false,
              can_restrict_members: false,
            };
          } else {
            const member = memberResult.result;
            const isAdmin = member.status === 'administrator' || member.status === 'creator';
            results.chat = {
              success: true,
              status: member.status,
              is_admin: isAdmin,
              can_invite_users: member.can_invite_users || member.status === 'creator',
              can_restrict_members: member.can_restrict_members || member.status === 'creator',
              can_promote_members: member.can_promote_members || member.status === 'creator',
            };
          }
        }

        // Check channel rights
        if (channel_id) {
          const memberResult = await telegramRequest(botToken, 'getChatMember', {
            chat_id: channel_id,
            user_id: botUserId,
          });

          if (!memberResult.ok) {
            results.channel = {
              success: false,
              error: memberResult.description || 'Failed to check channel member',
              is_member: false,
              is_admin: false,
              can_invite_users: false,
              can_restrict_members: false,
            };
          } else {
            const member = memberResult.result;
            const isAdmin = member.status === 'administrator' || member.status === 'creator';
            results.channel = {
              success: true,
              status: member.status,
              is_admin: isAdmin,
              can_invite_users: member.can_invite_users || member.status === 'creator',
              can_restrict_members: member.can_restrict_members || member.status === 'creator',
              can_post_messages: member.can_post_messages || member.status === 'creator',
            };
          }
        }

        return new Response(JSON.stringify({
          success: true,
          ...results,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    console.error('Bot actions error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
