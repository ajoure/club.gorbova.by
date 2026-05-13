// TEMPORARY smoke harness: runs morphology smoke without preview JWT.
// DELETE after smoke is closed.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveCanonicalPayload, generateCanonicalDocument } from '../_shared/document-render.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const guard = req.headers.get('x-smoke-key');
    if (guard !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors });
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json();
    const input = {
      template_id: body.template_id,
      template_version_id: body.template_version_id || null,
      context_type: body.context_type || null,
      context_id: body.context_id || null,
      executor_id: body.executor_id || null,
      legal_details_id: body.legal_details_id || null,
      signer_link_id: body.signer_link_id || null,
    };
    const profileId = body.profile_id || '00000000-0000-0000-0000-000000000000';
    const payload = await resolveCanonicalPayload(supabase, input as any);
    if (body.mode === 'preview') {
      return new Response(JSON.stringify({ payload }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const result = await generateCanonicalDocument(supabase, payload, {
      profileId,
      userId: body.user_id || '05cd3754-d589-4d90-97d1-89ba2bee610b',
      idempotencyKey: `smoke:${input.template_id}:${input.context_id}:${Date.now()}`,
    } as any);
    return new Response(JSON.stringify({
      success: result.success,
      error: (result as any).error,
      file_path: (result as any).file_path,
      document_number: (result as any).document_number,
      warnings: payload.warnings,
      resolved_tokens: payload.resolved_tokens,
      template_tokens: payload.template_tokens,
      aliases: (payload as any).aliases,
    }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e), stack: e?.stack }), { status: 500, headers: cors });
  }
});
