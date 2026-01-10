import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Telegram API helper
async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting subscription reminder check...');

    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

    // Find users whose subscription expires in 3 days (between 2 and 3 days from now)
    const { data: expiringAccess, error: queryError } = await supabase
      .from('telegram_access')
      .select(`
        id,
        user_id,
        club_id,
        active_until,
        telegram_clubs(
          club_name,
          bot_id,
          telegram_bots(bot_token_encrypted)
        )
      `)
      .or('state_chat.eq.active,state_channel.eq.active')
      .gte('active_until', twoDaysFromNow.toISOString())
      .lte('active_until', threeDaysFromNow.toISOString());

    if (queryError) {
      console.error('Failed to query expiring access:', queryError);
      throw queryError;
    }

    if (!expiringAccess || expiringAccess.length === 0) {
      console.log('No expiring subscriptions found for reminder');
      return new Response(JSON.stringify({ 
        success: true, 
        processed: 0,
        message: 'No expiring subscriptions found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${expiringAccess.length} expiring access records`);

    const results = [];
    
    for (const access of expiringAccess) {
      // Check if reminder was already sent today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      
      const { data: existingLog } = await supabase
        .from('telegram_logs')
        .select('id')
        .eq('user_id', access.user_id)
        .eq('action', 'reminder_sent')
        .gte('created_at', todayStart.toISOString())
        .maybeSingle();

      if (existingLog) {
        console.log(`Reminder already sent today for user ${access.user_id}`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'reminder_already_sent'
        });
        continue;
      }

      // Get user's telegram_user_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, full_name')
        .eq('user_id', access.user_id)
        .single();

      if (!profile?.telegram_user_id) {
        console.log(`User ${access.user_id} has no Telegram linked`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'no_telegram_linked'
        });
        continue;
      }

      // Check for manual access that might extend beyond
      const { data: manualAccess } = await supabase
        .from('telegram_manual_access')
        .select('*')
        .eq('user_id', access.user_id)
        .eq('club_id', access.club_id)
        .eq('is_active', true)
        .or(`valid_until.is.null,valid_until.gt.${threeDaysFromNow.toISOString()}`)
        .maybeSingle();

      if (manualAccess) {
        console.log(`User ${access.user_id} has extended manual access, skipping reminder`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'manual_access_active'
        });
        continue;
      }

      const club = access.telegram_clubs as any;
      const botToken = club?.telegram_bots?.bot_token_encrypted;
      
      if (!botToken) {
        console.log(`No bot token for club ${access.club_id}`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'no_bot_token'
        });
        continue;
      }

      // Format expiry date
      const expiryDate = new Date(access.active_until!);
      const formattedDate = expiryDate.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      // Send reminder message
      const message = `⏰ Небольшое напоминание

Твоя подписка в ${club.club_name || 'клубе'} заканчивается ${formattedDate}.

Чтобы не потерять доступ к чату и материалам, просто продли её заранее 💙`;

      // Use SITE_URL env var or construct from product landing page with pricing anchor
      const siteUrl = Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
      const keyboard = {
        inline_keyboard: [[
          { text: '💳 Продлить подписку', url: `${siteUrl}/club#pricing` }
        ]]
      };

      const sendResult = await telegramRequest(botToken, 'sendMessage', {
        chat_id: profile.telegram_user_id,
        text: message,
        reply_markup: keyboard,
      });

      // Log the reminder
      await supabase
        .from('telegram_logs')
        .insert({
          user_id: access.user_id,
          club_id: access.club_id,
          action: 'reminder_sent',
          target: 'user',
          status: sendResult.ok ? 'success' : 'error',
          error_message: sendResult.ok ? null : sendResult.description,
          meta: {
            expires_at: access.active_until,
            days_until_expiry: 3
          }
        });

      results.push({
        user_id: access.user_id,
        club_id: access.club_id,
        sent: sendResult.ok,
        error: sendResult.ok ? null : sendResult.description
      });
    }

    console.log('Reminder check completed');

    return new Response(JSON.stringify({ 
      success: true,
      processed: expiringAccess.length,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send reminders error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
