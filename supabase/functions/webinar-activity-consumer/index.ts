import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { mode = 'process_pending', limit = 50 } = body;

    // Fetch unprocessed webinar domain events
    const eventTypes = [
      'live_comment_created',
      'live_question_created',
      'live_reply_created',
      'live_user_removed_from_room',
      'live_user_banned_from_room',
      'live_user_restored_to_room',
    ];

    const { data: events, error: eventsError } = await supabase
      .from('domain_events')
      .select('*')
      .in('event_type', eventTypes)
      .eq('source', 'webinar')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (eventsError) {
      console.error('[webinar-activity-consumer] Failed to fetch events:', eventsError);
      return jsonRes({ status: 'error', message: eventsError.message }, 500);
    }

    if (!events || events.length === 0) {
      return jsonRes({ status: 'ok', processed: 0, message: 'No pending events' });
    }

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of events) {
      const idempotencyKey = `${event.event_type}:${event.entity_id}`;

      // Check idempotency — skip if already processed
      const { data: existing } = await supabase
        .from('crm_activity_log')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Record execution start
      let executionId: string | null = null;
      try {
        const { data: execData } = await supabase
          .from('domain_executions')
          .insert({
            event_id: event.id,
            step: 'crm_activity_write',
            status: 'pending',
            attempt: 1,
          })
          .select('id')
          .single();
        executionId = execData?.id || null;
      } catch (e) {
        console.error('[webinar-activity-consumer] Failed to record execution:', e);
      }

      try {
        const payload = event.payload as Record<string, any>;
        const userId = payload.user_id || payload.created_by;
        const liveEventId = payload.live_event_id;

        // Map event_type to activity_type
        const activityTypeMap: Record<string, string> = {
          'live_comment_created': 'webinar_comment',
          'live_question_created': 'webinar_question',
          'live_reply_created': 'webinar_reply',
          'live_user_removed_from_room': 'webinar_room_removal',
          'live_user_banned_from_room': 'webinar_room_ban',
          'live_user_restored_to_room': 'webinar_room_restore',
        };

        const activityType = activityTypeMap[event.event_type] || event.event_type;

        // Resolve contact_id from profiles if available
        let contactId: string | null = null;
        if (userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle();
          contactId = profile?.id || null;
        }

        // Get live event title for snapshot
        let titleSnapshot: string | null = null;
        if (liveEventId) {
          const { data: le } = await supabase
            .from('live_events')
            .select('title')
            .eq('id', liveEventId)
            .maybeSingle();
          titleSnapshot = le?.title || null;
        }

        // Write to crm_activity_log
        const { error: insertError } = await supabase
          .from('crm_activity_log')
          .insert({
            user_id: userId,
            contact_id: contactId,
            activity_type: activityType,
            source_entity_id: event.entity_id,
            source_entity_type: event.event_type,
            live_event_id: liveEventId,
            title_snapshot: titleSnapshot,
            text_snapshot: payload.content_preview || payload.reply_preview || payload.reason || null,
            author_snapshot: payload.author_display_name || null,
            visibility_scope: payload.visibility_scope || null,
            idempotency_key: idempotencyKey,
            metadata: {
              domain_event_id: event.id,
              action_type: payload.action_type || null,
            },
          });

        if (insertError) {
          throw insertError;
        }

        // Mark execution success
        if (executionId) {
          await supabase
            .from('domain_executions')
            .update({ status: 'success' })
            .eq('id', executionId);
        }

        processed++;
      } catch (err: any) {
        console.error(`[webinar-activity-consumer] Error processing event ${event.id}:`, err);
        errors++;

        // Mark execution failed
        if (executionId) {
          await supabase
            .from('domain_executions')
            .update({ status: 'failed', error: err.message || String(err) })
            .eq('id', executionId);
        }
      }
    }

    return jsonRes({
      status: 'ok',
      total: events.length,
      processed,
      skipped,
      errors,
    });
  } catch (err: any) {
    console.error('[webinar-activity-consumer] Unexpected error:', err);
    return jsonRes({ status: 'error', message: err.message || String(err) }, 500);
  }
});

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
