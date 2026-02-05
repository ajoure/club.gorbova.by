import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

async function telegramUploadMedia(
  botToken: string,
  method: string,
  chatId: string | number,
  mediaType: string,
  fileBuffer: ArrayBuffer,
  fileName: string,
  caption?: string,
  keyboard?: unknown
) {
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  
  const blob = new Blob([fileBuffer]);
  formData.append(mediaType, blob, fileName);
  
  if (caption) {
    formData.append('caption', caption);
    formData.append('parse_mode', 'Markdown');
  }
  
  if (keyboard) {
    formData.append('reply_markup', JSON.stringify(keyboard));
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}

interface BroadcastFilters {
  hasActiveSubscription?: boolean;
  productId?: string;
  clubId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
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

    // Parse request - support both JSON and FormData
    let message = '';
    let includeButton = false;
    let buttonText = '';
    let buttonUrl = ''; // Custom button URL support
    let filters: BroadcastFilters = {};
    let mediaType: string | null = null;
    let mediaBuffer: ArrayBuffer | null = null;
    let mediaFileName: string | null = null;

    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      message = formData.get('message') as string || '';
      includeButton = formData.get('include_button') === 'true';
      buttonText = formData.get('button_text') as string || '';
      buttonUrl = formData.get('button_url') as string || '';
      
      const filtersStr = formData.get('filters') as string;
      if (filtersStr) {
        filters = JSON.parse(filtersStr);
      }
      
      mediaType = formData.get('media_type') as string || null;
      const mediaFile = formData.get('media') as File | null;
      
      if (mediaFile) {
        mediaBuffer = await mediaFile.arrayBuffer();
        mediaFileName = mediaFile.name;
      }
    } else {
      const body = await req.json();
      message = body.message || '';
      includeButton = body.include_button || false;
      buttonText = body.button_text || '';
      buttonUrl = body.button_url || '';
      filters = body.filters || {};
    }

    if (!message && !mediaBuffer) {
      return new Response(
        JSON.stringify({ error: 'Message or media is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting mass broadcast...', { filters, hasMedia: !!mediaBuffer, mediaType });

    // Build user query based on filters
    let query = supabase
      .from('profiles')
      .select('user_id, telegram_user_id, full_name')
      .not('telegram_user_id', 'is', null);

    const { data: allProfiles } = await query.limit(1000);
    
    if (!allProfiles?.length) {
      return new Response(
        JSON.stringify({ error: 'No users with Telegram found', sent: 0, failed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let profiles = allProfiles;

    // Apply filters
    if (filters.hasActiveSubscription) {
      const { data: activeSubs } = await supabase
        .from('subscriptions_v2')
        .select('user_id')
        .eq('status', 'active');
      
      const activeUserIds = new Set(activeSubs?.map(s => s.user_id) || []);
      profiles = profiles.filter(p => activeUserIds.has(p.user_id));
    }

    if (filters.productId) {
      const { data: productSubs } = await supabase
        .from('subscriptions_v2')
        .select('user_id')
        .eq('product_id', filters.productId)
        .eq('status', 'active');

      const productUserIds = new Set(productSubs?.map(s => s.user_id) || []);
      profiles = profiles.filter(p => productUserIds.has(p.user_id));
    }

    if (filters.clubId) {
      const { data: clubAccess } = await supabase
        .from('telegram_access')
        .select('user_id')
        .eq('club_id', filters.clubId)
        .or('active_until.is.null,active_until.gt.now()');

      const clubUserIds = new Set(clubAccess?.map(a => a.user_id) || []);
      profiles = profiles.filter(p => clubUserIds.has(p.user_id));
    }

    console.log(`Found ${profiles.length} matching profiles`);

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
    // Use custom button URL if provided, otherwise fall back to APP_URL
    const appUrl = buttonUrl || Deno.env.get('APP_URL') || 'https://app.example.com';

    let sent = 0;
    let failed = 0;

    const keyboard = includeButton ? {
      inline_keyboard: [[
        { text: buttonText || 'Открыть платформу', url: appUrl }
      ]]
    } : undefined;

    // Send messages
    for (const profile of profiles) {
      try {
        let result;
        
        if (mediaBuffer && mediaType && mediaFileName) {
          // Send media message
          let method: string;
          let mediaField: string;
          
          switch (mediaType) {
            case 'photo':
              method = 'sendPhoto';
              mediaField = 'photo';
              break;
            case 'video':
              method = 'sendVideo';
              mediaField = 'video';
              break;
            case 'audio':
              method = 'sendAudio';
              mediaField = 'audio';
              break;
            case 'video_note':
              method = 'sendVideoNote';
              mediaField = 'video_note';
              break;
            default:
              method = 'sendDocument';
              mediaField = 'document';
          }
          
          result = await telegramUploadMedia(
            botToken,
            method,
            profile.telegram_user_id,
            mediaField,
            mediaBuffer,
            mediaFileName,
            message || undefined,
            keyboard
          );
        } else {
          // Send text message
          result = await telegramRequest(botToken, 'sendMessage', {
            chat_id: profile.telegram_user_id,
            text: message,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }

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

    // Log the broadcast action with full message text
    await supabase.from('telegram_logs').insert({
      action: 'MASS_NOTIFICATION',
      target: `${sent}/${sent + failed} users`,
      status: failed === 0 ? 'ok' : 'partial',
      message_text: message || null,  // PATCH: Store full message text for history
      meta: {
        total_users: sent + failed,
        sent,
        failed,
        has_media: !!mediaBuffer,
        media_type: mediaType,
        filters,
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
        has_media: !!mediaBuffer,
        media_type: mediaType,
        filters,
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
