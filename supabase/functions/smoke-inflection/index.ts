// TEMPORARY smoke harness — DELETE after smoke is closed.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as DR from '../_shared/document-render.ts';
const { generateCanonicalDocument } = DR as any;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json();
    if (body.action === 'sign') {
      const { data: signed } = await supabase.storage.from(body.bucket || 'documents').createSignedUrl(body.path, 3600);
      return new Response(JSON.stringify({ signed_url: signed?.signedUrl }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const input = {
      template_id: body.template_id,
      template_version_id: body.template_version_id || null,
      context_type: body.context_type || null,
      context_id: body.context_id || null,
    };
    const result = await generateCanonicalDocument(supabase, input as any, {
      profileId: body.profile_id,
      userId: body.user_id || '05cd3754-d589-4d90-97d1-89ba2bee610b',
      idempotencyKeyOverride: `smoke:${input.template_id}:${input.context_id}:${Date.now()}`,
      enforceFeatureFlag: false,
    } as any);
    const payload = (result as any).payload;
    return new Response(JSON.stringify({
      success: result.success,
      error: (result as any).error,
      document_id: (result as any).document_id,
      document_number: (result as any).document_number,
      storage_path: (result as any).storage_path,
      docx_check: (result as any).docx_check,
      reused: (result as any).reused,
      warnings: payload?.warnings,
    }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e), stack: e?.stack }), { status: 500, headers: cors });
  }
});
