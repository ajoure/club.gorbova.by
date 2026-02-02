import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Normalize timezone offset: +0300 → +03:00
 */
function normalizeTimezoneOffset(dateStr: string): string {
  return dateStr.replace(/([+-])(\d{2})(\d{2})$/, '$1$2:$3');
}

/**
 * Parse date from raw_data field
 */
function parseRawDate(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  
  const trimmed = value.trim();
  if (!trimmed) return null;
  
  // Normalize timezone offset
  const normalized = normalizeTimezoneOffset(trimmed);
  
  try {
    const date = new Date(normalized);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // ignore
  }
  
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dry_run = true, batch_size = 100, limit = 1000 } = await req.json().catch(() => ({}));

    console.log(`[backfill-dates] Starting: dry_run=${dry_run}, batch_size=${batch_size}, limit=${limit}`);

    // Find rows with NULL paid_at that have raw_data with date info
    const { data: candidates, error: fetchError } = await supabase
      .from('bepaid_statement_rows')
      .select('id, uid, raw_data, paid_at, created_at_bepaid')
      .is('paid_at', null)
      .limit(limit);

    if (fetchError) {
      throw new Error(`Failed to fetch candidates: ${fetchError.message}`);
    }

    const rows = candidates || [];
    console.log(`[backfill-dates] Found ${rows.length} candidates with NULL paid_at`);

    const updates: Array<{
      id: string;
      uid: string;
      paid_at: string | null;
      created_at_bepaid: string | null;
      raw_paid: string | null;
      raw_created: string | null;
    }> = [];

    for (const row of rows) {
      const rawData = row.raw_data as Record<string, unknown> | null;
      if (!rawData) continue;

      // Try different possible field names (case-insensitive matching done at import)
      const rawPaid = rawData['дата оплаты'] || rawData['Дата оплаты'];
      const rawCreated = rawData['дата создания'] || rawData['Дата создания'];

      const parsedPaid = parseRawDate(rawPaid);
      const parsedCreated = parseRawDate(rawCreated);

      // Only include if we can actually fill at least one date
      if (parsedPaid || parsedCreated) {
        updates.push({
          id: row.id,
          uid: row.uid,
          paid_at: parsedPaid,
          created_at_bepaid: parsedCreated,
          raw_paid: rawPaid as string | null,
          raw_created: rawCreated as string | null,
        });
      }
    }

    const foundRate = rows.length > 0 ? updates.length / rows.length : 0;
    console.log(`[backfill-dates] Parseable: ${updates.length}/${rows.length} (${(foundRate * 100).toFixed(1)}%)`);

    // DRY-RUN mode: return report only
    if (dry_run) {
      return new Response(
        JSON.stringify({
          success: true,
          mode: 'dry_run',
          total_scanned: rows.length,
          can_update: updates.length,
          found_rate: foundRate,
          sample: updates.slice(0, 20).map(u => ({
            uid: u.uid,
            raw_paid: u.raw_paid,
            parsed_paid: u.paid_at,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STOP-guard: if found_rate < 50%, refuse bulk update
    if (foundRate < 0.5 && updates.length > 10) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'STOP-guard triggered: found_rate < 50%',
          found_rate: foundRate,
          message: 'Too many rows cannot be parsed. Review raw_data format before proceeding.',
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // EXECUTE mode: update in batches
    let updatedCount = 0;
    let errorCount = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < updates.length; i += batch_size) {
      const batch = updates.slice(i, i + batch_size);

      for (const item of batch) {
        const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (item.paid_at) updateFields.paid_at = item.paid_at;
        if (item.created_at_bepaid) updateFields.created_at_bepaid = item.created_at_bepaid;

        const { error } = await supabase
          .from('bepaid_statement_rows')
          .update(updateFields)
          .eq('id', item.id);

        if (error) {
          errorCount++;
          errorDetails.push(`${item.uid}: ${error.message}`);
        } else {
          updatedCount++;
        }
      }
    }

    // Log to audit_logs
    await supabase.from('audit_logs').insert({
      action: 'backfill_bepaid_statement_dates',
      actor_type: 'system',
      actor_label: 'admin-backfill-bepaid-statement-dates',
      meta: {
        total_scanned: rows.length,
        updated_count: updatedCount,
        error_count: errorCount,
        sample_uids: updates.slice(0, 10).map(u => u.uid),
      },
    });

    console.log(`[backfill-dates] Complete: updated=${updatedCount}, errors=${errorCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'execute',
        total_scanned: rows.length,
        updated: updatedCount,
        errors: errorCount,
        error_details: errorDetails.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[backfill-dates] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
