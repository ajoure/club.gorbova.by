// Temporary invoker that calls telegram-revoke-access via supabase.functions.invoke
// This bypasses auth because it uses service role key internally
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  const targets = [
    { user_id: '80afcb07-3d07-40b8-aff7-c17e179e39f5', name: 'Diana Shulyak' },
    { user_id: 'c9e8dd78-b98d-4bf1-a275-041f60378fe9', name: 'Olga Severinenko' },
  ];
  
  const results = [];
  
  for (const t of targets) {
    console.log(`Revoking access for ${t.name}...`);
    const { data, error } = await supabase.functions.invoke('telegram-revoke-access', {
      body: {
        user_id: t.user_id,
        club_id: '4f8f9d8f-07ce-4898-8012-39f1035c1456',
        reason: 'wrong-grant cleanup: no subscription for product 85046734',
        is_manual: true,
        admin_id: 'system',
        force_revoke: true,
      },
    });
    results.push({ name: t.name, data, error: error?.message || null });
  }
  
  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
