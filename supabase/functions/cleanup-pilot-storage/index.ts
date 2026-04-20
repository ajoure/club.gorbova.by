import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  const paths = [
    'instagram-pilot/logo-real.png',
    'instagram-pilot/sample.mp3',
    'instagram-pilot/sample.mp4',
    'instagram-pilot/sample.pdf',
    'instagram-pilot/test.png',
  ];
  const { data, error } = await supabase.storage.from('telegram-media').remove(paths);
  return new Response(JSON.stringify({ data, error }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
