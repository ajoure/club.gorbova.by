const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Compatibility route for legacy callers.
 *
 * The old implementation was deleted while three callers still invoked it.
 * This route deliberately does not restore the unsafe direct test mode. It
 * accepts an existing order only and forwards the caller's credentials to the
 * canonical, RBAC-protected getcourse-grant-access function.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) {
      return jsonResponse({
        success: false,
        error: 'orderId is required; direct GetCourse test mode is disabled',
      }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authorization = req.headers.get('Authorization') || req.headers.get('authorization');
    const apiKey = req.headers.get('apikey');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    if (apiKey) headers.apikey = apiKey;

    const canonicalResponse = await fetch(`${supabaseUrl}/functions/v1/getcourse-grant-access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        order_id: orderId,
        force: body?.force === true,
        dry_run: body?.dry_run === true,
      }),
    });

    let canonical: Record<string, unknown> = {};
    try {
      canonical = await canonicalResponse.json();
    } catch {
      canonical = { error: 'Invalid response from getcourse-grant-access' };
    }

    if (!canonicalResponse.ok) {
      return jsonResponse({
        success: false,
        error: canonical.error || 'GetCourse sync failed',
        getcourse: { success: false, error: canonical.error || 'GetCourse sync failed' },
      }, canonicalResponse.status);
    }

    const synced = canonical.ok === true && canonical.status === 'success';
    return jsonResponse({
      success: true,
      getcourse: {
        success: synced,
        error: synced ? null : canonical.error || canonical.skipped_reason || 'GetCourse sync did not complete',
        gcOrderId: canonical.gc_order_id || null,
        gcDealNumber: canonical.gc_deal_number || null,
      },
      canonical_status: canonical.status || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[test-getcourse-sync] Compatibility call failed:', message);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
