import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TelegramExportMessage {
  id: number;
  type: string;
  date: string;
  date_unixtime?: string;
  from?: string;
  from_id?: string;
  text?: string | Array<{ type: string; text: string }>;
  text_entities?: Array<{ type: string; text: string }>;
  views?: number;
  forwards?: number;
  media_type?: string;
  photo?: string;
  file?: string;
}

interface TelegramExport {
  name: string;
  type: string;
  id: number;
  messages: TelegramExportMessage[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse multipart form data or JSON
    let exportData: TelegramExport;
    let targetChannelId: string | null = null;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await req.json();
      exportData = body.export_data;
      targetChannelId = body.channel_id || null;
    } else {
      return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!exportData || !exportData.messages) {
      return new Response(JSON.stringify({ error: 'Invalid export data: messages array required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[import-history] Processing export: ${exportData.name}, ${exportData.messages.length} messages`);

    // Determine channel_id from export or parameter
    const channelId = targetChannelId || `-100${exportData.id}`;

    // Filter only text messages (skip service messages, etc.)
    const textMessages = exportData.messages.filter((msg) => {
      if (msg.type !== 'message') return false;
      if (!msg.text) return false;
      // Extract text content
      const textContent = typeof msg.text === 'string' 
        ? msg.text 
        : Array.isArray(msg.text) 
          ? msg.text.map(t => typeof t === 'string' ? t : t.text).join('')
          : '';
      return textContent.trim().length > 0;
    });

    console.log(`[import-history] Found ${textMessages.length} text messages to import`);

    if (textMessages.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No text messages found to import',
        imported: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prepare records for insertion
    const records = textMessages.map((msg) => {
      // Extract text content
      let textContent = '';
      if (typeof msg.text === 'string') {
        textContent = msg.text;
      } else if (Array.isArray(msg.text)) {
        textContent = msg.text.map(t => typeof t === 'string' ? t : t.text).join('');
      }

      // Parse date
      let dateValue: string | null = null;
      if (msg.date_unixtime) {
        dateValue = new Date(parseInt(msg.date_unixtime) * 1000).toISOString();
      } else if (msg.date) {
        dateValue = new Date(msg.date).toISOString();
      }

      return {
        channel_id: channelId,
        telegram_message_id: msg.id,
        text: textContent,
        date: dateValue,
        from_name: msg.from || null,
        views: msg.views || 0,
        forwards: msg.forwards || 0,
        media_type: msg.media_type || (msg.photo ? 'photo' : msg.file ? 'file' : null),
        raw_data: msg,
      };
    });

    // Insert in batches of 100
    const batchSize = 100;
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { data, error } = await supabase
        .from('channel_posts_archive')
        .upsert(batch, {
          onConflict: 'channel_id,telegram_message_id',
          ignoreDuplicates: true,
        })
        .select('id');

      if (error) {
        console.error(`[import-history] Batch insert error:`, error);
        // Continue with next batch
        skipped += batch.length;
      } else {
        imported += data?.length || 0;
        skipped += batch.length - (data?.length || 0);
      }
    }

    console.log(`[import-history] Import complete: ${imported} imported, ${skipped} skipped`);

    // Log the action
    await supabase.from('telegram_logs').insert({
      action: 'CHANNEL_HISTORY_IMPORTED',
      target: exportData.name || channelId,
      status: 'ok',
      meta: {
        channel_id: channelId,
        channel_name: exportData.name,
        total_messages: exportData.messages.length,
        text_messages: textMessages.length,
        imported,
        skipped,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully imported ${imported} posts`,
      channel_id: channelId,
      channel_name: exportData.name,
      total_in_export: exportData.messages.length,
      text_messages: textMessages.length,
      imported,
      skipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[import-history] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
