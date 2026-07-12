// admin-notify-probe
// Temporary diagnostic function for PATCH-ADMIN-PURCHASE-NOTIFY-V1 smoke.
// Allows an admin/super_admin caller to invoke notify-order-purchased for a
// specific paid order with service-role authorization, awaiting the response.
// Used to isolate whether notify-order-purchased itself is reachable and
// functional, independently from grant-access-for-order lifecycle.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'unauthorized' }, 401)
  }
  const token = authHeader.slice(7).trim()

  const verifier = createClient(supabaseUrl, anonKey)
  const { data: claimsRes, error: claimsErr } = await verifier.auth.getClaims(token)
  if (claimsErr || !claimsRes?.claims?.sub) {
    return json({ error: 'unauthorized' }, 401)
  }
  const userId = claimsRes.claims.sub as string

  const admin = createClient(supabaseUrl, svcKey)
  const { data: isAdmin } = await admin.rpc('has_role', { _user_id: userId, _role: 'admin' })
  const { data: isSuper } = await admin.rpc('has_role', { _user_id: userId, _role: 'super_admin' })
  if (!isAdmin && !isSuper) {
    return json({ error: 'forbidden', reason: 'admin_required' }, 403)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const orderId: string | undefined = body?.order_id
  const force: boolean = !!body?.force
  if (!orderId) return json({ error: 'order_id_required' }, 400)

  const startedAt = Date.now()
  let status = 0
  let responseBody: any = null
  let fetchError: string | null = null
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/notify-order-purchased`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${svcKey}`,
      },
      body: JSON.stringify({ order_id: orderId, force }),
    })
    status = r.status
    const text = await r.text()
    try { responseBody = JSON.parse(text) } catch { responseBody = text }
  } catch (e) {
    fetchError = (e as Error)?.message || String(e)
  }
  const elapsedMs = Date.now() - startedAt

  // Read back deliveries for the order right now
  const { data: deliveries } = await admin
    .from('order_notification_deliveries')
    .select('channel, notification_type, recipient, status, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  return json({
    ok: !fetchError && status >= 200 && status < 300,
    order_id: orderId,
    notify_status: status,
    notify_body: responseBody,
    fetch_error: fetchError,
    elapsed_ms: elapsedMs,
    deliveries_after: deliveries || [],
    deliveries_count: (deliveries || []).length,
  })
})
