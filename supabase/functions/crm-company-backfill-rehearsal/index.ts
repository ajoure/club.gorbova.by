// Phase 3B rollback-only rehearsal endpoint (internal-only, temporary).
// - Requires header `x-phase3b-token` matching PHASE3B_REHEARSAL_TOKEN.
// - Calls the private SECURITY DEFINER function public.crm_phase3b_rehearsal_replay()
//   via a service_role client. That function performs preflight + 16+1 waves +
//   in-transaction assertions + full second pass, then RAISES an expected
//   rollback marker (SQLSTATE P3B01) so the whole transaction is aborted.
// - We accept ONLY the expected rollback marker as PASS, then independently
//   re-check that canonical tables are back to baseline zero.
// - This function must be deleted immediately after PASS.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-phase3b-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPECTED_MARKER = 'PHASE3B_REHEARSAL_EXPECTED_ROLLBACK';
const EXPECTED_SQLSTATE = 'P3B01';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const expected = Deno.env.get('PHASE3B_REHEARSAL_TOKEN');
  const provided = req.headers.get('x-phase3b-token');
  if (!expected || !provided || provided !== expected) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Invoke the replay RPC. Success return is impossible by design: the
  //    function ALWAYS raises the expected marker. Anything else = blocker.
  const { data, error } = await db.rpc('crm_phase3b_rehearsal_replay');

  let rehearsalStatus: 'PASS' | 'BLOCKER' = 'BLOCKER';
  let markerPayload: unknown = null;
  let rehearsalError: unknown = null;

  if (!error) {
    rehearsalError = { reason: 'rpc_returned_without_expected_rollback', data };
  } else {
    // Supabase JS surfaces PG error as { code, message, details, hint }
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? '';
    if (code === EXPECTED_SQLSTATE && message.includes(EXPECTED_MARKER)) {
      rehearsalStatus = 'PASS';
      // Extract JSON payload after the marker prefix.
      const idx = message.indexOf('{');
      if (idx >= 0) {
        try {
          markerPayload = JSON.parse(message.slice(idx));
        } catch (e) {
          markerPayload = { parse_error: String(e), raw_tail: message.slice(idx, idx + 200) };
        }
      }
    } else {
      rehearsalError = {
        code,
        message,
        details: (error as { details?: string }).details,
        hint: (error as { hint?: string }).hint,
      };
    }
  }

  // 2) INDEPENDENT residual check — must equal baseline zero regardless of
  //    rehearsalStatus. Uses fresh queries in a separate REST transaction.
  const residual: Record<string, number | null> = {
    companies: null,
    map: null,
    contacts_billing: null,
    seq_company: null,
  };
  try {
    const q = async (fn: () => Promise<{ count: number | null; error: unknown }>) => {
      const r = await fn();
      if (r.error) throw r.error;
      return r.count ?? -1;
    };
    residual.companies = await q(() =>
      db.from('companies').select('id', { count: 'exact', head: true }) as unknown as Promise<{ count: number | null; error: unknown }>,
    );
    residual.map = await q(() =>
      db.from('client_legal_details_company_map').select('id', { count: 'exact', head: true }) as unknown as Promise<{ count: number | null; error: unknown }>,
    );
    residual.contacts_billing = await q(() =>
      db.from('company_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('relationship_type', 'billing_contact')
        .eq('is_billing_contact', true) as unknown as Promise<{ count: number | null; error: unknown }>,
    );
    const seq = await db.from('public_id_sequences').select('last_value').eq('entity_type', 'company').maybeSingle();
    if (seq.error) throw seq.error;
    residual.seq_company = (seq.data?.last_value as number | undefined) ?? null;
  } catch (e) {
    return new Response(
      JSON.stringify({
        status: 'BLOCKER',
        reason: 'residual_check_failed',
        residual_error: String(e),
        rehearsal: { status: rehearsalStatus, marker_payload: markerPayload, error: rehearsalError },
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const residualClean =
    residual.companies === 0 &&
    residual.map === 0 &&
    residual.contacts_billing === 0 &&
    residual.seq_company === 0;

  const overall = rehearsalStatus === 'PASS' && residualClean ? 'PASS' : 'BLOCKER';

  return new Response(
    JSON.stringify({
      status: overall,
      rehearsal: { status: rehearsalStatus, marker_payload: markerPayload, error: rehearsalError },
      residual,
      residual_clean: residualClean,
    }),
    {
      status: overall === 'PASS' ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
