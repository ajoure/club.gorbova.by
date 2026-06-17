// TEMP: D7-422 proof runner. Deploys with verify_jwt=false; gated by CRON_SECRET.
// Performs: (1) snapshot pf-000005 value, (2) clear it via service-role,
// (3) mint a real user session via admin.generateLink + verifyOtp,
// (4) invoke ai-generate-document-package as the session owner,
// (5) restore pf-000005, (6) return outcome + before/after doc count.
// REMOVE after proof.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-cron-secret',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cronSecret = Deno.env.get('CRON_SECRET')!;
  const provided = req.headers.get('x-cron-secret');
  if (provided !== cronSecret) return j({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const sessionId: string = body.session_id;
  const itemId: string = body.item_id;
  const fieldCatalogId: string = body.field_catalog_id; // UUID of pf-000005 in document_package_field_catalog
  const ownerEmail: string = body.owner_email;
  if (!sessionId || !itemId || !fieldCatalogId || !ownerEmail) return j({ error: 'missing_args' }, 400);

  const admin = createClient(url, srk);

  // 1) snapshot existing value (session-level row, package_template_item_id IS NULL)
  const { data: existing } = await admin
    .from('document_package_session_field_values')
    .select('value_text,value_date,value_datetime,value_json,value_number,value_time,value_boolean')
    .eq('session_id', sessionId)
    .eq('field_catalog_id', fieldCatalogId)
    .is('package_template_item_id', null)
    .maybeSingle();
  if (!existing) return j({ error: 'baseline_value_missing' }, 400);

  // 2) clear (delete) it
  const { error: delErr } = await admin
    .from('document_package_session_field_values')
    .delete()
    .eq('session_id', sessionId)
    .eq('field_catalog_id', fieldCatalogId)
    .is('package_template_item_id', null);
  if (delErr) return j({ error: 'clear_failed', detail: delErr.message }, 500);

  // 3) mint user JWT
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: ownerEmail });
  const otp = (link.data as any)?.properties?.email_otp;
  if (!otp) {
    // restore
    await admin.from('document_package_session_field_values').insert({
      session_id: sessionId, field_catalog_id: fieldCatalogId, ...existing,
    });
    return j({ error: 'otp_generation_failed', detail: link.error?.message }, 500);
  }
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
  const verify = await anon.auth.verifyOtp({ email: ownerEmail, token: otp, type: 'email' });
  const access = verify.data?.session?.access_token;
  if (!access) {
    await admin.from('document_package_session_field_values').insert({
      session_id: sessionId, field_catalog_id: fieldCatalogId, ...existing,
    });
    return j({ error: 'verify_failed', detail: verify.error?.message }, 500);
  }

  // doc count before
  const { count: before } = await admin
    .from('ai_generated_documents')
    .select('id', { count: 'exact', head: true })
    .eq('meta->>package_session_id', sessionId);

  // 4) invoke orchestrator as user
  const invokeRes = await fetch(`${url}/functions/v1/ai-generate-document-package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}`, apikey: Deno.env.get('SUPABASE_ANON_KEY')! },
    body: JSON.stringify({ package_session_id: sessionId }),
  });
  const invokeStatus = invokeRes.status;
  const invokeBody = await invokeRes.json().catch(() => ({}));

  // doc count after
  const { count: after } = await admin
    .from('ai_generated_documents')
    .select('id', { count: 'exact', head: true })
    .eq('meta->>package_session_id', sessionId);

  // 5) restore value
  const { error: restoreErr } = await admin
    .from('document_package_session_field_values')
    .insert({
      session_id: sessionId, field_catalog_id: fieldCatalogId,
      value_text: existing.value_text, value_date: existing.value_date,
      value_datetime: existing.value_datetime, value_json: existing.value_json,
      value_number: existing.value_number, value_time: existing.value_time,
      value_boolean: existing.value_boolean,
    });

  return j({
    ok: true,
    before_count: before,
    after_count: after,
    docs_created: (after ?? 0) - (before ?? 0),
    invoke_http_status: invokeStatus,
    invoke_response: invokeBody,
    restore_error: restoreErr?.message ?? null,
  });
});
