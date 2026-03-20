import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (req.headers.get('x-cron-secret') !== cronSecret || !cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const creds = await getBepaidCredsStrict(supabase);
  if (isBepaidCredsError(creds)) return new Response(JSON.stringify({ error: creds.error }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const auth = createBepaidAuthHeader(creds);

  const body = await req.json().catch(() => ({}));
  const results: any = {};

  // Test: search by bePaid order_id (259141368)
  const orderId = body.bepaid_order_id;
  if (orderId) {
    try {
      const r = await fetch(`https://gateway.bepaid.by/transactions?order_id=${orderId}&per_page=10`, {
        headers: { 'Authorization': auth, 'Accept': 'application/json', 'X-Api-Version': '3' },
      });
      results.by_order_id = { status: r.status, body: await r.json().catch(() => r.statusText) };
    } catch (e) { results.by_order_id = { error: String(e) }; }
  }

  // Test: beyag endpoint
  const uid = body.uid;
  if (uid) {
    try {
      const r = await fetch(`https://api.bepaid.by/beyag/transactions/${uid}`, {
        headers: { 'Authorization': auth, 'Accept': 'application/json' },
      });
      results.beyag = { status: r.status, body: await r.json().catch(() => r.statusText) };
    } catch (e) { results.beyag = { error: String(e) }; }
  }

  return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
