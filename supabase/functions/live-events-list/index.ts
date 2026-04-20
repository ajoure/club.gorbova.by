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

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Требуется авторизация' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Неверный токен' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Fetch all published events
    const { data: events, error: eventsError } = await supabase
      .from('live_events')
      .select('id, slug, title, description, event_type, platform_status, scheduled_at, event_timezone, replay_enabled, is_published, status, room_state')
      .eq('is_published', true)
      .order('scheduled_at', { ascending: false, nullsFirst: false });

    if (eventsError) {
      console.error('[live-events-list] DB error:', eventsError);
      return new Response(
        JSON.stringify({ error: 'Ошибка загрузки' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!events || events.length === 0) {
      return new Response(
        JSON.stringify({ events: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter by access using the canonical RPC
    const accessibleEvents: typeof events = [];

    for (const event of events) {
      const { data: hasAccess } = await supabase.rpc('user_has_live_event_access', {
        _user_id: userId,
        _live_event_id: event.id,
      });

      if (hasAccess) {
        accessibleEvents.push(event);
      }
    }

    // Filter out events in terminal states without replay
    const visibleEvents = accessibleEvents.filter(e => {
      if (e.platform_status === 'ended' && !e.replay_enabled) return false;
      if (e.platform_status === 'archived') return false;
      return true;
    });

    return new Response(
      JSON.stringify({
        events: visibleEvents.map(e => ({
          id: e.id,
          slug: e.slug,
          title: e.title,
          description: e.description,
          event_type: e.event_type,
          platform_status: e.platform_status,
          scheduled_at: e.scheduled_at,
          event_timezone: e.event_timezone,
          replay_enabled: e.replay_enabled,
          room_state: (e as any).room_state ?? 'closed',
        })),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[live-events-list] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Внутренняя ошибка' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
