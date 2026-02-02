import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILD_ID = "2026-02-02T12:00:00Z-backfill-fields-v1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Mojibake mapping for the 3 critical fields only (amount, status, transaction_type)
 * These are the corrupted UTF-8 strings that appear when Excel encoding fails
 */
const AMOUNT_KEYS = [
  'сумма', 'Сумма',
  'ð¡ñð¼ð¼ð°', // mojibake
];

const STATUS_KEYS = [
  'статус', 'Статус',
  'ð¡ñð°ñññ', // mojibake
];

const TRANSACTION_TYPE_KEYS = [
  'тип транзакции', 'Тип транзакции',
  'ð¢ð¸ð¿ ññð°ð½ð·ð°ðºñð¸ð¸', // mojibake
];

/**
 * Find value from raw_data by trying multiple keys
 */
function findValue(rawData: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (rawData[key] !== undefined && rawData[key] !== null && rawData[key] !== '') {
      return rawData[key];
    }
  }
  // Try lowercase matching as fallback
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(rawData)) {
      if (k.toLowerCase() === lowerKey && v !== undefined && v !== null && v !== '') {
        return v;
      }
    }
  }
  return null;
}

/**
 * Parse number from various formats
 */
function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

serve(async (req) => {
  console.log(`[${BUILD_ID}] START admin-backfill-bepaid-statement-fields`);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify admin role
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roleData } = await supabase
      .from('user_roles_v2')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'superadmin'])
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request
    const body = await req.json();
    const { dry_run = true, limit = 1000 } = body;

    // Find candidates: rows with NULL critical fields but have raw_data
    const { data: candidates, error: fetchError } = await supabase
      .from('bepaid_statement_rows')
      .select('id, uid, amount, status, transaction_type, raw_data')
      .or('amount.is.null,status.is.null,transaction_type.is.null')
      .not('raw_data', 'is', null)
      .limit(limit);

    if (fetchError) {
      throw new Error(`Fetch error: ${fetchError.message}`);
    }

    console.log(`[${BUILD_ID}] Found ${candidates?.length || 0} candidates`);

    const results = {
      total_candidates: candidates?.length || 0,
      parseable: 0,
      not_parseable: 0,
      updated: 0,
      errors: 0,
    };

    const updates: Array<{
      id: string;
      uid: string;
      amount: number | null;
      status: string | null;
      transaction_type: string | null;
    }> = [];

    for (const row of candidates || []) {
      const rawData = row.raw_data as Record<string, unknown>;
      if (!rawData || typeof rawData !== 'object') {
        results.not_parseable++;
        continue;
      }

      let anyParsed = false;
      const update: {
        id: string;
        uid: string;
        amount: number | null;
        status: string | null;
        transaction_type: string | null;
      } = {
        id: row.id,
        uid: row.uid,
        amount: row.amount,
        status: row.status,
        transaction_type: row.transaction_type,
      };

      // Try to extract amount
      if (row.amount === null) {
        const val = findValue(rawData, AMOUNT_KEYS);
        const parsed = parseNumber(val);
        if (parsed !== null) {
          update.amount = parsed;
          anyParsed = true;
        }
      }

      // Try to extract status
      if (row.status === null) {
        const val = findValue(rawData, STATUS_KEYS);
        if (val && typeof val === 'string') {
          update.status = val;
          anyParsed = true;
        }
      }

      // Try to extract transaction_type
      if (row.transaction_type === null) {
        const val = findValue(rawData, TRANSACTION_TYPE_KEYS);
        if (val && typeof val === 'string') {
          update.transaction_type = val;
          anyParsed = true;
        }
      }

      if (anyParsed) {
        results.parseable++;
        updates.push(update);
      } else {
        results.not_parseable++;
      }
    }

    const parseableRate = results.total_candidates > 0 
      ? results.parseable / results.total_candidates 
      : 0;

    console.log(`[${BUILD_ID}] Parseable: ${results.parseable}, Not parseable: ${results.not_parseable}, Rate: ${(parseableRate * 100).toFixed(1)}%`);

    // DRY-RUN: return stats only
    if (dry_run) {
      await supabase.from('audit_logs').insert({
        action: 'bepaid_statement_backfill.fields.dry_run',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: `admin-backfill-bepaid-statement-fields/${BUILD_ID}`,
        meta: {
          build_id: BUILD_ID,
          initiator_user_id: user.id,
          ...results,
          parseable_rate: parseableRate,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        mode: 'dry_run',
        build_id: BUILD_ID,
        ...results,
        parseable_rate: parseableRate,
        sample_updates: updates.slice(0, 3).map(u => ({
          uid: u.uid,
          amount: u.amount,
          status: u.status,
          transaction_type: u.transaction_type,
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // EXECUTE: STOP-guard check
    if (parseableRate < 0.50 && results.total_candidates > 50) {
      return new Response(JSON.stringify({
        success: false,
        error: `STOP-guard: parseable_rate ${(parseableRate * 100).toFixed(1)}% < 50% with ${results.total_candidates} candidates. Data may be too corrupted.`,
        mode: 'execute_blocked',
        ...results,
        parseable_rate: parseableRate,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Execute updates one by one (for reliability)
    for (const update of updates) {
      const { error } = await supabase
        .from('bepaid_statement_rows')
        .update({
          amount: update.amount,
          status: update.status,
          transaction_type: update.transaction_type,
          updated_at: new Date().toISOString(),
        })
        .eq('id', update.id);

      if (error) {
        console.error(`[${BUILD_ID}] Update error for ${update.uid}:`, error.message);
        results.errors++;
      } else {
        results.updated++;
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'bepaid_statement_backfill.fields.execute',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: `admin-backfill-bepaid-statement-fields/${BUILD_ID}`,
      meta: {
        build_id: BUILD_ID,
        initiator_user_id: user.id,
        ...results,
        parseable_rate: parseableRate,
      },
    });

    console.log(`[${BUILD_ID}] END: updated=${results.updated}, errors=${results.errors}`);

    return new Response(JSON.stringify({
      success: true,
      mode: 'execute',
      build_id: BUILD_ID,
      ...results,
      parseable_rate: parseableRate,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[${BUILD_ID}] Error:`, error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      build_id: BUILD_ID,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
