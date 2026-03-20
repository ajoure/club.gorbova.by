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
  const uid = body.uid;
  const results: any = {};

  // Test 1: /transactions/{uid}
  try {
    const r1 = await fetch(`https://gateway.bepaid.by/transactions/${uid}`, {
      headers: { 'Authorization': auth, 'Accept': 'application/json', 'X-Api-Version': '3' },
    });
    results.by_uid = { status: r1.status, body: await r1.json().catch(() => r1.statusText) };
  } catch (e) { results.by_uid = { error: String(e) }; }

  // Test 2: /transactions?tracking_id=...
  const trackingId = body.tracking_id;
  if (trackingId) {
    try {
      const r2 = await fetch(`https://gateway.bepaid.by/transactions?tracking_id=${encodeURIComponent(trackingId)}`, {
        headers: { 'Authorization': auth, 'Accept': 'application/json', 'X-Api-Version': '3' },
      });
      results.by_tracking_id = { status: r2.status, body: await r2.json().catch(() => r2.statusText) };
    } catch (e) { results.by_tracking_id = { error: String(e) }; }
  }

  // Test 3: known successful uid
  const successUid = body.success_uid;
  if (successUid) {
    try {
      const r3 = await fetch(`https://gateway.bepaid.by/transactions/${successUid}`, {
        headers: { 'Authorization': auth, 'Accept': 'application/json', 'X-Api-Version': '3' },
      });
      results.success_lookup = { status: r3.status, body: await r3.json().catch(() => r3.statusText) };
    } catch (e) { results.success_lookup = { error: String(e) }; }
  }

  return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
