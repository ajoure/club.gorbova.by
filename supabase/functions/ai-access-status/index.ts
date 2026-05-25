// ai-access-status — read-only projection поверх _shared/ai-access.ts.
// Никакой собственной бизнес-логики. Никаких маппингов product_id здесь.
// Источник истины — _shared/ai-access.ts (resolveAiAccess + isModeAllowed + LIMITS).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveAiAccessStatus } from '../_shared/ai-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Необходима авторизация' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Неавторизованный доступ' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const service = createClient(supabaseUrl, supabaseServiceKey);

    // Берём актуальный каталог видимых сценариев — резолвер прав знает только их коды.
    const { data: scenarios } = await service
      .from('ai_user_prompts')
      .select('code')
      .eq('is_active', true)
      .eq('is_archived', false)
      .eq('is_visible_in_chat', true)
      .not('code', 'is', null);
    const knownCodes = Array.from(new Set((scenarios || []).map((s: any) => s.code).filter(Boolean)));

    const status = await resolveAiAccessStatus(service, user.id, knownCodes);

    return new Response(JSON.stringify(status), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('ai-access-status error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Внутренняя ошибка' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
