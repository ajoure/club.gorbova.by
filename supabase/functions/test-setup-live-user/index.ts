import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// TEMPORARY diagnostic function — creates a confirmed test user with entitlement.
// Guarded by a shared secret. DELETE after live-events testing is done.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const secret = body.secret;
    if (secret !== 'lovable-diagnose-live-2026-07-03') {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const email = body.email || 'lovable-test-live@example.com';
    const password = body.password || 'TestLive!2026';
    const productId = body.product_id || '11c9f1b8-0355-4753-bd74-40b42aa53616';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Try to find existing user
    let userId: string | null = null;
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      userId = existing.id;
      await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true });
    } else {
      const { data: created, error: cerr } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (cerr) return new Response(JSON.stringify({ error: cerr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      userId = created.user!.id;
    }

    // Grant unlimited entitlement to product for access checks
    await supabase.from('entitlements').upsert({
      user_id: userId,
      product_id: productId,
      status: 'active',
      expires_at: null,
    }, { onConflict: 'user_id,product_id' });

    return new Response(JSON.stringify({ ok: true, user_id: userId, email, password }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
