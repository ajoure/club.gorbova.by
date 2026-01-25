import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode, decode as base64Decode } from 'https://deno.land/std@0.208.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * PATCH-5: Admin tool to fix club billing dates (dry-run → execute)
 * 
 * Problems addressed:
 * - next_charge_at IS NULL
 * - Year >= 2027 (from 365-day fallback bug)
 * - Period > 40 days (should be ~30 for monthly)
 * - Misaligned: abs(next_charge_at - access_end_at) > 1 hour
 * 
 * Business rule: Club = calendar month (+1 month), next_charge_at = access_end_at
 * 
 * SECURITY: Uses HMAC-based preview_hash with TTL to prevent accidental execute
 */

// Staff emails to NEVER modify (exclude from any updates)
const EXCLUDED_STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com', 
  'ceo@ajoure.by',
  'irenessa@yandex.ru',  // IMPORTANT: yandex.ru, not .by
];

const CLUB_PRODUCT_ID = '11c9f1b8-0355-4753-bd74-40b42aa53616';
const PREVIEW_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface RequestBody {
  dry_run: boolean;
  limit?: number;
  preview_hash?: string;  // Required for execute - HMAC-validated
}

interface ProblematicSubscription {
  id: string;
  user_id: string;
  profile_id: string;
  email: string;
  full_name: string;
  status: string;
  auto_renew: boolean;
  access_start_at: string;
  access_end_at: string;
  next_charge_at: string | null;
  created_at: string;
  problem_type: string[];
}

// HMAC helper functions
async function createHmac(payload: object, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(payload)));
  return base64Encode(new Uint8Array(signature));
}

async function verifyHmac(previewHash: string, secret: string): Promise<{ valid: boolean; payload?: any; error?: string }> {
  try {
    const [payloadB64, signatureB64] = previewHash.split('.');
    if (!payloadB64 || !signatureB64) {
      return { valid: false, error: 'Invalid hash format' };
    }
    
    const payloadStr = new TextDecoder().decode(base64Decode(payloadB64));
    const payload = JSON.parse(payloadStr);
    
    // Check TTL
    if (payload.exp < Date.now()) {
      return { valid: false, error: 'Preview expired. Run dry_run again.' };
    }
    
    // Verify signature
    const expectedSignature = await createHmac(payload, secret);
    if (expectedSignature !== signatureB64) {
      return { valid: false, error: 'Invalid signature' };
    }
    
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: `Hash verification failed: ${e}` };
  }
}

async function generatePreviewHash(subscriptionIds: string[], userId: string, secret: string): Promise<string> {
  const payload = {
    ids: subscriptionIds.slice(0, 20),  // First 20 IDs for verification
    count: subscriptionIds.length,
    user: userId,
    exp: Date.now() + PREVIEW_TTL_MS,
  };
  const signature = await createHmac(payload, secret);
  const payloadB64 = base64Encode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${payloadB64}.${signature}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    
    // Admin check
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin permission
    const { data: hasPermission } = await userClient.rpc('has_permission', {
      _user_id: user.id,
      _permission_code: 'subscriptions.edit',
    });

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: 'Access denied. Required permission: subscriptions.edit' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body: RequestBody = await req.json();
    const { dry_run = true, limit = 50, preview_hash } = body;

    // STOP: Limit validation
    const effectiveLimit = Math.min(Math.max(1, limit), 200);
    
    console.log(`[admin-fix-club-billing-dates] mode=${dry_run ? 'dry_run' : 'execute'}, limit=${effectiveLimit}`);

    // =================================================================
    // Find problematic club subscriptions
    // =================================================================
    const { data: allSubs, error: queryError } = await supabase
      .from('subscriptions_v2')
      .select(`
        id,
        user_id,
        profile_id,
        status,
        auto_renew,
        access_start_at,
        access_end_at,
        next_charge_at,
        created_at,
        meta
      `)
      .eq('product_id', CLUB_PRODUCT_ID)
      .in('status', ['active', 'trial', 'past_due'])
      .limit(500);  // Fetch more to filter

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    // Get profiles for email filtering
    const userIds = [...new Set((allSubs || []).map(s => s.user_id).filter(Boolean))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email, full_name')
      .in('user_id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

    // Filter and classify problematic subscriptions
    const problematic: ProblematicSubscription[] = [];
    const now = new Date();

    for (const sub of allSubs || []) {
      const profile = profileMap.get(sub.user_id);
      const email = profile?.email || '';

      // STOP: Skip staff members
      if (EXCLUDED_STAFF_EMAILS.includes(email.toLowerCase())) {
        console.log(`[admin-fix-club-billing-dates] Skipping staff: ${email}`);
        continue;
      }

      const problems: string[] = [];
      
      const accessStart = sub.access_start_at ? new Date(sub.access_start_at) : null;
      const accessEnd = sub.access_end_at ? new Date(sub.access_end_at) : null;
      const nextCharge = sub.next_charge_at ? new Date(sub.next_charge_at) : null;
      const createdAt = sub.created_at ? new Date(sub.created_at) : null;

      // Problem 1: next_charge_at IS NULL
      if (!nextCharge && sub.auto_renew) {
        problems.push('null_next_charge');
      }

      // Problem 2: Year >= 2027
      if (accessStart && accessStart.getFullYear() >= 2027) problems.push('year_2027_start');
      if (accessEnd && accessEnd.getFullYear() >= 2027) problems.push('year_2027_end');
      if (nextCharge && nextCharge.getFullYear() >= 2027) problems.push('year_2027_next');

      // Problem 3: Period > 40 days (should be ~30 for monthly)
      if (accessStart && accessEnd) {
        const periodDays = (accessEnd.getTime() - accessStart.getTime()) / (24 * 60 * 60 * 1000);
        if (periodDays > 40) {
          problems.push('period_too_long');
        }
      }

      // Problem 4: Misaligned (next_charge_at != access_end_at, diff > 1 hour)
      if (nextCharge && accessEnd) {
        const diffHours = Math.abs(nextCharge.getTime() - accessEnd.getTime()) / (60 * 60 * 1000);
        if (diffHours > 1) {
          problems.push('misaligned');
        }
      }

      if (problems.length > 0) {
        problematic.push({
          id: sub.id,
          user_id: sub.user_id,
          profile_id: sub.profile_id,
          email,
          full_name: profile?.full_name || '',
          status: sub.status,
          auto_renew: sub.auto_renew,
          access_start_at: sub.access_start_at,
          access_end_at: sub.access_end_at,
          next_charge_at: sub.next_charge_at,
          created_at: sub.created_at,
          problem_type: problems,
        });
      }
    }

    // STOP: Too many affected
    if (problematic.length > effectiveLimit) {
      return new Response(JSON.stringify({
        error: `Too many affected subscriptions: ${problematic.length}. Max allowed: ${effectiveLimit}`,
        suggestion: 'Increase limit or run in batches',
        total_found: problematic.length,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate HMAC-secured preview hash for execute validation
    const previewSecret = Deno.env.get('PREVIEW_HASH_SECRET') || 'fallback-secret-change-in-prod';
    const previewHashGenerated = await generatePreviewHash(
      problematic.map(p => p.id),
      user.id,
      previewSecret
    );

    // =================================================================
    // DRY RUN - just return the report
    // =================================================================
    if (dry_run) {
      // Calculate statistics
      const stats = {
        total: problematic.length,
        null_next_charge: problematic.filter(p => p.problem_type.includes('null_next_charge')).length,
        year_2027: problematic.filter(p => p.problem_type.some(t => t.startsWith('year_2027'))).length,
        period_too_long: problematic.filter(p => p.problem_type.includes('period_too_long')).length,
        misaligned: problematic.filter(p => p.problem_type.includes('misaligned')).length,
      };

      // Log dry run
      await supabase.from('audit_logs').insert({
        action: 'admin.fix_club_billing_dates_dry_run',
        actor_type: 'user',
        actor_user_id: user.id,
        actor_label: 'admin-fix-club-billing-dates',
        meta: {
          stats,
          sample_ids: problematic.slice(0, 10).map(p => p.id),
          excluded_staff: EXCLUDED_STAFF_EMAILS,
        }
      });

      return new Response(JSON.stringify({
        mode: 'dry_run',
        preview_hash: previewHashGenerated,
        stats,
        subscriptions: problematic.map(p => ({
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          status: p.status,
          auto_renew: p.auto_renew,
          problem_type: p.problem_type,
          current: {
            access_start_at: p.access_start_at,
            access_end_at: p.access_end_at,
            next_charge_at: p.next_charge_at,
          },
          fix_preview: calculateFix(p),
        })),
        execute_info: {
          to_update: problematic.length,
          excluded_staff: EXCLUDED_STAFF_EMAILS,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =================================================================
    // EXECUTE - apply fixes
    // =================================================================
    
    // STOP: Require and VALIDATE preview_hash (HMAC + TTL)
    if (!preview_hash) {
      return new Response(JSON.stringify({
        error: 'Execute requires preview_hash from dry_run. Run dry_run first.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const verifyResult = await verifyHmac(preview_hash, previewSecret);
    
    if (!verifyResult.valid) {
      return new Response(JSON.stringify({
        error: verifyResult.error || 'Invalid preview_hash',
        hint: 'Run dry_run again to get a fresh preview_hash',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the preview was created by the same user
    if (verifyResult.payload?.user !== user.id) {
      return new Response(JSON.stringify({
        error: 'Preview hash was created by a different user',
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Execute updates
    const results = {
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      sample: [] as any[],
    };

    for (const sub of problematic) {
      try {
        const fix = calculateFix(sub);
        
        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update({
            access_start_at: fix.access_start_at,
            access_end_at: fix.access_end_at,
            next_charge_at: fix.next_charge_at,
            meta: {
              ...(sub as any).meta,
              billing_fix: {
                fixed_at: new Date().toISOString(),
                fixed_by: user.id,
                old_access_start: sub.access_start_at,
                old_access_end: sub.access_end_at,
                old_next_charge: sub.next_charge_at,
                problems_fixed: sub.problem_type,
              },
            },
          })
          .eq('id', sub.id);

        if (updateError) {
          results.errors.push(`${sub.id}: ${updateError.message}`);
        } else {
          results.updated++;
          if (results.sample.length < 10) {
            results.sample.push({
              id: sub.id,
              email: sub.email,
              problems_fixed: sub.problem_type,
              old: { access_start_at: sub.access_start_at, access_end_at: sub.access_end_at, next_charge_at: sub.next_charge_at },
              new: fix,
            });
          }
        }
      } catch (e) {
        results.errors.push(`${sub.id}: ${String(e)}`);
      }
    }

    // Log execute
    await supabase.from('audit_logs').insert({
      action: 'admin.fix_club_billing_dates_execute',
      actor_type: 'user',
      actor_user_id: user.id,
      actor_label: 'admin-fix-club-billing-dates',
      meta: {
        total_found: problematic.length,
        updated: results.updated,
        skipped: results.skipped,
        errors_count: results.errors.length,
        sample: results.sample,
        excluded_staff: EXCLUDED_STAFF_EMAILS,
      }
    });

    return new Response(JSON.stringify({
      mode: 'execute',
      results: {
        total_found: problematic.length,
        updated: results.updated,
        skipped: results.skipped,
        errors: results.errors.slice(0, 10),
      },
      sample: results.sample,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('admin-fix-club-billing-dates error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Calculate the correct dates for a subscription using calendar month rule
 */
function calculateFix(sub: ProblematicSubscription): {
  access_start_at: string;
  access_end_at: string;
  next_charge_at: string;
} {
  let accessStart = new Date(sub.access_start_at);
  const createdAt = new Date(sub.created_at);

  // Fix "year shift" bug: if access_start is in 2027 but created_at in 2026
  // and difference is 300-430 days, reset access_start to created_at
  const yearStart = accessStart.getFullYear();
  const yearCreated = createdAt.getFullYear();
  
  if (yearStart >= 2027 && yearCreated <= 2026) {
    const diffDays = (accessStart.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
    if (diffDays >= 300 && diffDays <= 430) {
      console.log(`[fix] Year shift detected for ${sub.id}: resetting access_start from ${accessStart.toISOString()} to ${createdAt.toISOString()}`);
      accessStart = createdAt;
    }
  }

  // Calculate calendar month end: 22.01 → 22.02 → 22.03
  const accessEnd = new Date(Date.UTC(
    accessStart.getUTCFullYear(),
    accessStart.getUTCMonth() + 1,  // +1 calendar month
    accessStart.getUTCDate(),
    12, 0, 0  // Normalize to noon UTC
  ));

  // Handle edge case: 31 Jan → 28/29 Feb (clamp to last day of month)
  if (accessEnd.getUTCDate() !== accessStart.getUTCDate()) {
    const lastDay = new Date(Date.UTC(
      accessStart.getUTCFullYear(),
      accessStart.getUTCMonth() + 2,
      0,  // Last day of previous month
      12, 0, 0
    ));
    return {
      access_start_at: accessStart.toISOString(),
      access_end_at: lastDay.toISOString(),
      next_charge_at: lastDay.toISOString(),
    };
  }

  return {
    access_start_at: accessStart.toISOString(),
    access_end_at: accessEnd.toISOString(),
    next_charge_at: accessEnd.toISOString(),  // Invariant: next_charge_at = access_end_at
  };
}
