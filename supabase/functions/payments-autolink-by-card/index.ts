import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * payments-autolink-by-card
 * 
 * Auto-links historical payments/queue items to a profile when a card is added.
 * 
 * Matching priorities:
 * - P0: By provider_token (exact match)
 * - P1: By card_last4 + card_brand (only if no collision exists)
 * - P2: last4-only is FORBIDDEN
 * 
 * Safety:
 * - Never overwrites existing profile_id if different from target
 * - Stops if collision detected (same last4+brand linked to multiple profiles)
 * - Stops if too many candidates found (configurable limit)
 * - Dry-run mode by default
 */

interface AutolinkRequest {
  profile_id: string;
  user_id?: string | null;
  card_last4: string;
  card_brand: string;
  provider_token?: string;
  dry_run?: boolean;
  limit?: number;
  unsafe_allow_large?: boolean;
  force_ignore_collision?: boolean; // NEW: bypass collision check
}

interface AutolinkResponse {
  ok: boolean;
  dry_run: boolean;
  status: 'success' | 'stop' | 'error';
  stats: {
    candidates_payments: number;
    candidates_queue: number;
    updated_payments_profile: number;
    updated_queue_profile: number;
    skipped_already_linked: number;
    conflicts: number;
  };
  stop_reason?: string;
  force_linked?: boolean; // NEW: indicates forced linking despite collision
  samples?: {
    payments_updated: Array<{ id: string; bepaid_uid?: string; amount: number; paid_at?: string }>;
    conflicts: Array<{ id: string; reason: string }>;
  };
}

// Normalize card brand for comparison
function normalizeBrand(brand: string | null | undefined): string {
  if (!brand) return '';
  const b = brand.toLowerCase().trim();
  // Map common variations
  const brandMap: Record<string, string> = {
    'visa': 'visa',
    'mastercard': 'mastercard',
    'master': 'mastercard',
    'mc': 'mastercard',
    'belkart': 'belkart',
    'belcard': 'belkart',
    'maestro': 'maestro',
    'mir': 'mir',
  };
  return brandMap[b] || b;
}

// Get all brand variants for matching (handles master vs mastercard mismatch)
function getBrandVariants(brand: string): string[] {
  const normalized = normalizeBrand(brand);
  const variants = [normalized];
  
  // Add raw input if different from normalized
  if (brand && brand.toLowerCase().trim() !== normalized) {
    variants.push(brand.toLowerCase().trim());
  }
  
  // Add known aliases for each brand
  if (normalized === 'mastercard') {
    variants.push('master', 'mc');
  } else if (normalized === 'belkart') {
    variants.push('belcard');
  }
  
  return [...new Set(variants.filter(Boolean))];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request
    const body: AutolinkRequest = await req.json();
    const {
      profile_id,
      user_id,
      card_last4,
      card_brand,
      provider_token,
      dry_run = true,
      limit = 200,
      unsafe_allow_large = false,
      force_ignore_collision = false,
    } = body;

    console.log(`[payments-autolink-by-card] Starting: profile=${profile_id}, last4=${card_last4}, brand=${card_brand}, dry_run=${dry_run}`);

    // Validate required params
    if (!profile_id || !card_last4 || !card_brand) {
      return new Response(JSON.stringify({
        ok: false,
        dry_run,
        status: 'error',
        stats: { candidates_payments: 0, candidates_queue: 0, updated_payments_profile: 0, updated_queue_profile: 0, skipped_already_linked: 0, conflicts: 0 },
        stop_reason: 'missing_required_params',
      } as AutolinkResponse), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const normalizedBrand = normalizeBrand(card_brand);
    const normalizedLast4 = card_last4.trim();
    const brandVariants = getBrandVariants(card_brand);
    
    console.log(`[payments-autolink-by-card] Brand variants for '${card_brand}': ${JSON.stringify(brandVariants)}`);

    // ========== GUARD-CHECK: Collision detection ==========
    // Check if this last4+brand is already linked to a DIFFERENT profile
    
    // 1) Check card_profile_links table (using brand variants for matching)
    const { data: existingLinks } = await supabase
      .from('card_profile_links')
      .select('profile_id')
      .eq('card_last4', normalizedLast4)
      .in('card_brand', brandVariants);

    const linkedProfileIds = new Set<string>();
    existingLinks?.forEach(link => {
      if (link.profile_id) linkedProfileIds.add(link.profile_id);
    });

    // 2) Check payment_methods table (using brand variants for matching)
    const { data: existingMethods } = await supabase
      .from('payment_methods')
      .select('user_id')
      .eq('last4', normalizedLast4)
      .in('brand', brandVariants)
      .eq('status', 'active');

    // Get profile_ids from payment_methods via user_id
    if (existingMethods && existingMethods.length > 0) {
      const userIds = existingMethods.map(m => m.user_id).filter(Boolean);
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id')
          .in('user_id', userIds);
        profiles?.forEach(p => linkedProfileIds.add(p.id));
      }
    }

    // Collision check: if linked to 2+ profiles, STOP (unless force_ignore_collision)
    // But allow if all are the same profile (ours)
    linkedProfileIds.delete(profile_id); // Remove our target profile
    
    let forceLinked = false;
    
    if (linkedProfileIds.size > 0) {
      // Card is linked to at least one OTHER profile
      console.log(`[payments-autolink-by-card] COLLISION: last4=${normalizedLast4} brand=${normalizedBrand} linked to ${linkedProfileIds.size + 1} profiles, force=${force_ignore_collision}`);
      
      if (!force_ignore_collision) {
        // Log the collision and stop
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'payments_autolink_by_card',
          action: 'payments_autolink_by_card',
          meta: {
            profile_id,
            last4: normalizedLast4,
            brand: normalizedBrand,
            dry_run,
            status: 'stop',
            stop_reason: 'card_collision_last4_brand',
            other_profiles: Array.from(linkedProfileIds).slice(0, 5),
          },
        });

        return new Response(JSON.stringify({
          ok: true,  // Managed stop, not error
          dry_run,
          status: 'stop',
          stats: { candidates_payments: 0, candidates_queue: 0, updated_payments_profile: 0, updated_queue_profile: 0, skipped_already_linked: 0, conflicts: 0 },
          stop_reason: 'card_collision_last4_brand',
          force_linked: false,
        } as AutolinkResponse), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // Force ignore collision - log warning and continue
        console.log(`[payments-autolink-by-card] FORCE LINK: bypassing collision for profile ${profile_id}`);
        forceLinked = true;
        
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'payments_autolink_by_card',
          action: 'payments_autolink_force_collision',
          meta: {
            profile_id,
            last4: normalizedLast4,
            brand: normalizedBrand,
            dry_run,
            force_ignore_collision: true,
            force_linked: true,
            other_profiles: Array.from(linkedProfileIds).slice(0, 5),
            warning: 'Admin forced link despite collision - card may be shared',
          },
        });
      }
    }

    // ========== FIND CANDIDATES ==========
    
    // Stats tracking
    let candidatesPayments = 0;
    let candidatesQueue = 0;
    let updatedPayments = 0;
    let updatedQueue = 0;
    let skippedAlreadyLinked = 0;
    let conflicts = 0;
    const paymentsSamples: Array<{ id: string; bepaid_uid?: string; amount: number; paid_at?: string }> = [];
    const conflictsSamples: Array<{ id: string; reason: string }> = [];

    // ========== P0: Match by provider_token ==========
    let tokenMatches: string[] = [];
    if (provider_token) {
      const { data: tokenPayments } = await supabase
        .from('payments_v2')
        .select('id, profile_id')
        .eq('payment_token', provider_token)
        .limit(limit);

      tokenPayments?.forEach(p => {
        if (!p.profile_id) {
          tokenMatches.push(p.id);
        } else if (p.profile_id !== profile_id) {
          conflicts++;
          conflictsSamples.push({ id: p.id, reason: 'profile_id_mismatch_token' });
        }
      });
    }

    // ========== P1: Match by last4 + brand ==========
    
    // 1) payments_v2: Find unlinked payments with matching card (using brand variants)
    const { data: paymentsRaw } = await supabase
      .from('payments_v2')
      .select('id, profile_id, provider_payment_id, amount, paid_at')
      .eq('card_last4', normalizedLast4)
      .in('card_brand', brandVariants)
      .limit(limit + 100); // Extra buffer for filtering

    const paymentsToUpdate: Array<{ id: string; bepaid_uid?: string; amount: number; paid_at?: string }> = [];
    
    paymentsRaw?.forEach(p => {
      if (tokenMatches.includes(p.id)) return; // Already in P0
      
      if (!p.profile_id) {
        paymentsToUpdate.push({
          id: p.id,
          bepaid_uid: p.provider_payment_id || undefined,
          amount: Number(p.amount) || 0,
          paid_at: p.paid_at || undefined,
        });
      } else if (p.profile_id === profile_id) {
        skippedAlreadyLinked++;
      } else {
        conflicts++;
        conflictsSamples.push({ id: p.id, reason: 'profile_id_mismatch' });
      }
    });

    // Add P0 matches
    if (tokenMatches.length > 0) {
      const { data: tokenPaymentsData } = await supabase
        .from('payments_v2')
        .select('id, provider_payment_id, amount, paid_at')
        .in('id', tokenMatches);
      
      tokenPaymentsData?.forEach(p => {
        paymentsToUpdate.push({
          id: p.id,
          bepaid_uid: p.provider_payment_id || undefined,
          amount: Number(p.amount) || 0,
          paid_at: p.paid_at || undefined,
        });
      });
    }

    candidatesPayments = paymentsToUpdate.length;

    // 2) payment_reconcile_queue: Find unlinked queue items (using brand variants)
    const { data: queueRaw } = await supabase
      .from('payment_reconcile_queue')
      .select('id, matched_profile_id, bepaid_uid, amount, paid_at')
      .eq('card_last4', normalizedLast4)
      .in('card_brand', brandVariants)
      .limit(limit + 100);

    const queueToUpdate: Array<{ id: string; bepaid_uid?: string; amount: number; paid_at?: string }> = [];
    
    queueRaw?.forEach(q => {
      if (!q.matched_profile_id) {
        queueToUpdate.push({
          id: q.id,
          bepaid_uid: q.bepaid_uid || undefined,
          amount: Number(q.amount) || 0,
          paid_at: q.paid_at || undefined,
        });
      } else if (q.matched_profile_id === profile_id) {
        skippedAlreadyLinked++;
      } else {
        conflicts++;
        conflictsSamples.push({ id: q.id, reason: 'matched_profile_id_mismatch' });
      }
    });

    candidatesQueue = queueToUpdate.length;

    // ========== STOP CHECK: Too many candidates ==========
    const totalCandidates = candidatesPayments + candidatesQueue;
    
    if (totalCandidates > limit && !unsafe_allow_large) {
      console.log(`[payments-autolink-by-card] STOP: too_many_candidates (${totalCandidates} > ${limit})`);
      
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_label: 'payments_autolink_by_card',
        action: 'payments_autolink_by_card',
        meta: {
          profile_id,
          last4: normalizedLast4,
          brand: normalizedBrand,
          dry_run,
          status: 'stop',
          stop_reason: 'too_many_candidates',
          candidates_payments: candidatesPayments,
          candidates_queue: candidatesQueue,
          limit,
        },
      });

      return new Response(JSON.stringify({
        ok: false,
        dry_run,
        status: 'stop',
        stats: { 
          candidates_payments: candidatesPayments, 
          candidates_queue: candidatesQueue, 
          updated_payments_profile: 0, 
          updated_queue_profile: 0, 
          skipped_already_linked: skippedAlreadyLinked, 
          conflicts 
        },
        stop_reason: 'too_many_candidates',
        samples: {
          payments_updated: [],
          conflicts: conflictsSamples.slice(0, 10),
        },
      } as AutolinkResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== EXECUTE or DRY-RUN ==========
    
    if (dry_run) {
      console.log(`[payments-autolink-by-card] DRY-RUN: would update ${candidatesPayments} payments, ${candidatesQueue} queue items`);
      
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_label: 'payments_autolink_by_card',
        action: 'payments_autolink_by_card',
        meta: {
          profile_id,
          user_id,
          last4: normalizedLast4,
          brand: normalizedBrand,
          dry_run: true,
          status: 'success',
          candidates_payments: candidatesPayments,
          candidates_queue: candidatesQueue,
          skipped_already_linked: skippedAlreadyLinked,
          conflicts,
          limit,
          duration_ms: Date.now() - startTime,
        },
      });

      return new Response(JSON.stringify({
        ok: true,
        dry_run: true,
        status: 'success',
        stats: { 
          candidates_payments: candidatesPayments, 
          candidates_queue: candidatesQueue, 
          updated_payments_profile: 0, 
          updated_queue_profile: 0, 
          skipped_already_linked: skippedAlreadyLinked, 
          conflicts 
        },
        samples: {
          payments_updated: paymentsToUpdate.slice(0, 10),
          conflicts: conflictsSamples.slice(0, 10),
        },
      } as AutolinkResponse), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== EXECUTE: Update in batches ==========
    const BATCH_SIZE = 50;

    // Update payments_v2
    for (let i = 0; i < paymentsToUpdate.length; i += BATCH_SIZE) {
      const batch = paymentsToUpdate.slice(i, i + BATCH_SIZE);
      const ids = batch.map(p => p.id);
      
      const { error } = await supabase
        .from('payments_v2')
        .update({ 
          profile_id,
          updated_at: new Date().toISOString(),
        })
        .in('id', ids)
        .is('profile_id', null); // Double-check: only update if still null

      if (error) {
        console.error(`[payments-autolink-by-card] Error updating payments batch:`, error);
      } else {
        updatedPayments += batch.length;
        paymentsSamples.push(...batch.slice(0, 5));
      }
    }

    // Update payment_reconcile_queue
    for (let i = 0; i < queueToUpdate.length; i += BATCH_SIZE) {
      const batch = queueToUpdate.slice(i, i + BATCH_SIZE);
      const ids = batch.map(q => q.id);
      
      const { error } = await supabase
        .from('payment_reconcile_queue')
        .update({ 
          matched_profile_id: profile_id,
          updated_at: new Date().toISOString(),
        })
        .in('id', ids)
        .is('matched_profile_id', null); // Double-check: only update if still null

      if (error) {
        console.error(`[payments-autolink-by-card] Error updating queue batch:`, error);
      } else {
        updatedQueue += batch.length;
      }
    }

    // ========== AUDIT LOG ==========
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_label: 'payments_autolink_by_card',
      action: 'payments_autolink_by_card',
      meta: {
        profile_id,
        user_id,
        last4: normalizedLast4,
        brand: normalizedBrand,
        dry_run: false,
        status: 'success',
        candidates_payments: candidatesPayments,
        candidates_queue: candidatesQueue,
        updated_payments_profile: updatedPayments,
        updated_queue_profile: updatedQueue,
        skipped_already_linked: skippedAlreadyLinked,
        conflicts,
        limit,
        unsafe_allow_large,
        duration_ms: Date.now() - startTime,
      },
    });

    console.log(`[payments-autolink-by-card] DONE: updated ${updatedPayments} payments, ${updatedQueue} queue items for profile ${profile_id}${forceLinked ? ' (force linked)' : ''}`);

    return new Response(JSON.stringify({
      ok: true,
      dry_run: false,
      status: 'success',
      force_linked: forceLinked,
      stats: { 
        candidates_payments: candidatesPayments, 
        candidates_queue: candidatesQueue, 
        updated_payments_profile: updatedPayments, 
        updated_queue_profile: updatedQueue, 
        skipped_already_linked: skippedAlreadyLinked, 
        conflicts 
      },
      samples: {
        payments_updated: paymentsSamples.slice(0, 10),
        conflicts: conflictsSamples.slice(0, 10),
      },
    } as AutolinkResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[payments-autolink-by-card] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({
      ok: false,
      dry_run: true,
      status: 'error',
      stats: { candidates_payments: 0, candidates_queue: 0, updated_payments_profile: 0, updated_queue_profile: 0, skipped_already_linked: 0, conflicts: 0 },
      stop_reason: message,
    } as AutolinkResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
