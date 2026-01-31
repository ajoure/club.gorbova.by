import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PATCH 4: Nightly System Health - Core monitoring function
 * 
 * Features:
 * - Validates x-cron-secret header
 * - Guard: runs only at 03:00 Europe/London
 * - Creates run record in system_health_runs
 * - Invokes nightly-payments-invariants
 * - Sends Telegram alert to owner on FAIL
 * - Writes audit_logs with SYSTEM ACTOR
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface HealthCheckResult {
  name: string;
  passed: boolean;
  count: number;
  samples: any[];
  description: string;
}

interface NightlyReport {
  success: boolean;
  run_at: string;
  duration_ms: number;
  invariants: HealthCheckResult[];
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Verify cron secret for scheduled runs
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    
    // Also allow authenticated admin calls
    const authHeader = req.headers.get('authorization');
    const isScheduledRun = cronSecret === expectedSecret;
    const isAuthenticatedCall = !!authHeader;
    
    if (!isScheduledRun && !isAuthenticatedCall) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await req.json().catch(() => ({}));
    const source = body.source || 'manual';
    const targetTz = body.target_tz || 'Europe/London';
    const targetHour = body.target_hour ?? 3;
    const notifyOwner = body.notify_owner !== false;

    // DST-resistant: Check if current hour in target timezone matches target
    const nowInTargetTz = new Date().toLocaleString('en-US', { 
      timeZone: targetTz, 
      hour: 'numeric', 
      hour12: false 
    });
    const currentHour = parseInt(nowInTargetTz, 10);
    
    // Allow manual runs OR scheduled runs at target hour
    if (source === 'cron-hourly' && currentHour !== targetHour) {
      console.log(`[NIGHTLY] Skipped: current hour ${currentHour} != target ${targetHour} in ${targetTz}`);
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: `not_target_hour (current: ${currentHour}, target: ${targetHour}, tz: ${targetTz})` 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[NIGHTLY] Starting system health check (source: ${source}, tz: ${targetTz}, hour: ${currentHour})`);

    // Create run record
    const { data: run, error: runError } = await supabase
      .from('system_health_runs')
      .insert({
        run_type: source === 'cron-hourly' ? 'nightly' : source,
        status: 'running',
        meta: {
          source,
          target_tz: targetTz,
          target_hour: targetHour,
          actual_hour: currentHour,
        }
      })
      .select('id')
      .single();

    if (runError) {
      console.error('[NIGHTLY] Failed to create run record:', runError);
      throw runError;
    }

    const runId = run.id;
    console.log(`[NIGHTLY] Created run ${runId}`);

    // Execute all invariants from nightly-payments-invariants
    const invariantsResponse = await supabase.functions.invoke('nightly-payments-invariants', {
      body: { run_id: runId },
    });

    const invariantsResult: NightlyReport = invariantsResponse.data || {
      success: false,
      run_at: new Date().toISOString(),
      duration_ms: 0,
      invariants: [],
      summary: { total_checks: 0, passed: 0, failed: 0 }
    };

    const failedChecks = invariantsResult.invariants?.filter((i) => !i.passed) || [];

    // Save checks to system_health_checks
    for (const inv of invariantsResult.invariants || []) {
      const checkKey = inv.name.split(':')[0].trim();
      const category = inv.name.toLowerCase().includes('payment') ? 'payments' : 
                       inv.name.toLowerCase().includes('telegram') ? 'telegram' : 
                       inv.name.toLowerCase().includes('access') ? 'access' :
                       inv.name.toLowerCase().includes('entitlement') ? 'access' :
                       inv.name.toLowerCase().includes('subscription') ? 'access' : 'system';

      await supabase.from('system_health_checks').insert({
        run_id: runId,
        check_key: checkKey,
        check_name: inv.name,
        category,
        status: inv.passed ? 'passed' : 'failed',
        details: { description: inv.description },
        sample_rows: inv.samples,
        count: inv.count,
        duration_ms: null,
      });
    }

    // Finalize run
    const finalStatus = failedChecks.length > 0 ? 'failed' : 'completed';
    await supabase
      .from('system_health_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: finalStatus,
        summary: invariantsResult.summary,
      })
      .eq('id', runId);

    // PATCH 9: Send Telegram alert to super_admin owner if FAIL
    if (failedChecks.length > 0 && notifyOwner) {
      // Find super_admin owner by email
      const ownerEmail = '7500084@gmail.com';
      
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('telegram_user_id, full_name')
        .eq('email', ownerEmail)
        .maybeSingle();
      
      // PATCH-A: Get bot token from env first, fallback to DB only if not set
      // TODO: Remove DB fallback after full migration to env secrets
      let botToken = Deno.env.get('PRIMARY_TELEGRAM_BOT_TOKEN');
      
      if (!botToken) {
        // Fallback: Get from telegram_bots table (legacy, to be removed)
        const { data: primaryBot } = await supabase
          .from('telegram_bots')
          .select('bot_token_encrypted')
          .eq('is_primary', true)
          .eq('status', 'active')
          .maybeSingle();
        botToken = primaryBot?.bot_token_encrypted || null;
        if (botToken) {
          console.warn('[NIGHTLY] Using bot token from DB (legacy). Migrate to PRIMARY_TELEGRAM_BOT_TOKEN env secret.');
        }
      }
      
      if (ownerProfile?.telegram_user_id && botToken) {
        // Build plain-text message (NO Markdown to avoid parsing issues)
        const nowStr = new Date().toLocaleString('ru-RU', { timeZone: targetTz });
        let alertText = `NIGHTLY CHECK: ${failedChecks.length}/${invariantsResult.summary?.total_checks || 0} FAILED\n\n`;
        
        for (const check of failedChecks.slice(0, 5)) {
          alertText += `FAIL: ${check.name}\n`;
          alertText += `  Issues: ${check.count}\n`;
          if (check.samples?.[0]) {
            const sampleStr = JSON.stringify(check.samples[0]);
            alertText += `  Sample: ${sampleStr.slice(0, 80)}${sampleStr.length > 80 ? '...' : ''}\n`;
          }
          alertText += '\n';
        }
        
        if (failedChecks.length > 5) {
          alertText += `... and ${failedChecks.length - 5} more\n\n`;
        }
        
        alertText += `Run: ${nowStr} ${targetTz}\n`;
        alertText += `Duration: ${Date.now() - startTime}ms\n`;
        alertText += `Run ID: ${runId}`;

        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ownerProfile.telegram_user_id,
              text: alertText,
              // NO parse_mode = plain text (more reliable)
            }),
          });
          console.log(`[NIGHTLY] Sent alert to owner ${ownerProfile.full_name} (TG: ${ownerProfile.telegram_user_id})`);
        } catch (tgError) {
          console.error('[NIGHTLY] Failed to send Telegram alert:', tgError);
        }
      } else {
        console.warn('[NIGHTLY] Owner not found or no Telegram linked:', { 
          ownerEmail, 
          hasTelegram: !!ownerProfile?.telegram_user_id,
          hasToken: !!botToken,
          tokenSource: Deno.env.get('PRIMARY_TELEGRAM_BOT_TOKEN') ? 'env' : 'db_fallback'
        });
      }
    }

    // PATCH 12: Audit log with SYSTEM ACTOR (MANDATORY)
    await supabase.from('audit_logs').insert({
      action: 'nightly.system_health_run',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'nightly-system-health',
      meta: {
        run_id: runId,
        duration_ms: Date.now() - startTime,
        total_checks: invariantsResult.summary?.total_checks,
        passed: invariantsResult.summary?.passed,
        failed: invariantsResult.summary?.failed,
        source,
        target_tz: targetTz,
        target_hour: targetHour,
        notify_sent: failedChecks.length > 0 && notifyOwner,
        owner_email: '7500084@gmail.com',
      },
    });

    console.log(`[NIGHTLY] Completed in ${Date.now() - startTime}ms. Status: ${finalStatus}. Passed: ${invariantsResult.summary?.passed}/${invariantsResult.summary?.total_checks}`);

    return new Response(JSON.stringify({
      success: failedChecks.length === 0,
      run_id: runId,
      status: finalStatus,
      ...invariantsResult.summary,
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[NIGHTLY] Error:', error);

    // Log error to audit
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'nightly-system-health',
        action: 'nightly.system_health_error',
        meta: {
          error: String(error),
          duration_ms: Date.now() - startTime,
        },
      });
    } catch (auditError) {
      console.error('[NIGHTLY] Failed to log error:', auditError);
    }

    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
