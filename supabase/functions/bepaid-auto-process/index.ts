import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildAdminNotifyMessage } from '../_shared/admin-notify-message.ts';
import { buildPurchaseSnapshot } from '../_shared/build-purchase-snapshot.ts';
import { parseBepaidTrackingId } from '../_shared/bepaid-tracking-id.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface QueueItem {
  id: string;
  bepaid_uid: string | null;
  tracking_id: string | null;
  amount: number | null;
  currency: string;
  customer_email: string | null;
  customer_name: string | null;
  customer_surname: string | null;
  customer_phone: string | null;
  card_last4: string | null;
  card_holder: string | null;
  card_brand: string | null;
  product_name: string | null;
  tariff_name: string | null;
  description: string | null;
  matched_profile_id: string | null;
  matched_product_id: string | null;
  matched_tariff_id: string | null;
  matched_order_id: string | null;
  status: string;
  source: string;
  paid_at: string | null;
  created_at: string;
  created_at_bepaid: string | null;
  ip_address: string | null;
  attempts: number;
  transaction_type: string | null;
  reference_transaction_uid: string | null;
  raw_payload: any;
}

async function ensureCanonicalPayment(
  supabase: any,
  item: QueueItem,
  order: { id: string; profile_id?: string | null; final_price?: number | null; currency?: string | null },
  profileId: string | null,
  paidAt: string,
) {
  if (!item.bepaid_uid) {
    throw new Error(`Queue item ${item.id} has no bePaid UID`);
  }

  const amount = item.amount ?? order.final_price;
  if (!amount || amount <= 0) {
    throw new Error(`Queue item ${item.id} has invalid payment amount`);
  }

  const paymentRow = {
    order_id: order.id,
    profile_id: profileId || order.profile_id || null,
    amount,
    currency: item.currency || order.currency || "BYN",
    status: "succeeded",
    provider: "bepaid",
    provider_payment_id: item.bepaid_uid,
    paid_at: paidAt,
    card_last4: item.card_last4,
    card_brand: item.card_brand,
    provider_response: item.raw_payload || {
      card_last4: item.card_last4,
      card_holder: item.card_holder,
      card_brand: item.card_brand,
    },
    meta: {
      source: "bepaid_auto_process",
      queue_id: item.id,
      tracking_id: item.tracking_id,
      customer_email: item.customer_email,
    },
  };

  const { data: existing, error: existingError } = await supabase
    .from("payments_v2")
    .select("id,order_id")
    .eq("provider", "bepaid")
    .eq("provider_payment_id", item.bepaid_uid)
    .maybeSingle();

  if (existingError) {
    throw new Error(`payments_v2 lookup failed: ${existingError.message}`);
  }

  let repairedOrphan = false;
  if (existing?.order_id && existing.order_id !== order.id) {
    throw new Error(
      `payments_v2 conflict: payment ${existing.id} is already linked to order ${existing.order_id}`,
    );
  }

  if (existing && !existing.order_id) {
    const { data: repaired, error: repairError } = await supabase
      .from("payments_v2")
      .update(paymentRow)
      .eq("id", existing.id)
      .is("order_id", null)
      .select("id,order_id")
      .maybeSingle();

    if (repairError || !repaired) {
      throw new Error(
        `payments_v2 orphan repair failed: ${repairError?.message || "row changed concurrently"}`,
      );
    }
    repairedOrphan = true;
  } else if (!existing) {
    const { error: writeError } = await supabase
      .from("payments_v2")
      .insert(paymentRow);

    if (writeError) {
      throw new Error(`payments_v2 write failed: ${writeError.message}`);
    }
  }

  const { data: persisted, error: verifyError } = await supabase
    .from("payments_v2")
    .select("id,order_id")
    .eq("provider", "bepaid")
    .eq("provider_payment_id", item.bepaid_uid)
    .maybeSingle();

  if (verifyError || !persisted) {
    throw new Error(`payments_v2 verification failed: ${verifyError?.message || "row missing"}`);
  }

  if (persisted.order_id !== order.id) {
    throw new Error(
      `payments_v2 verification failed: expected order ${order.id}, got ${persisted.order_id || "null"}`,
    );
  }

  return { ...persisted, repaired_orphan: repairedOrphan };
}

async function grantCanonicalAccess(
  supabase: any,
  orderId: string,
  customAccessDays?: number,
) {
  const body: Record<string, unknown> = {
    orderId,
    grantTelegram: true,
    grantGetcourse: false,
  };
  if (customAccessDays && customAccessDays > 0) {
    body.customAccessDays = customAccessDays;
  }

  const { data, error } = await supabase.functions.invoke("grant-access-for-order", {
    body,
  });

  if (error) {
    throw new Error(`grant-access-for-order failed for order ${orderId}: ${error.message}`);
  }
  if (!data || data.success !== true) {
    throw new Error(
      `grant-access-for-order failed for order ${orderId}: ${data?.error || "invalid response"}`,
    );
  }

  return data;
}

// Transliterate Latin name to Cyrillic for matching
function transliterateToCyrillic(name: string): string {
  const map: Record<string, string> = {
    'a': 'а', 'b': 'б', 'c': 'ц', 'd': 'д', 'e': 'е', 'f': 'ф',
    'g': 'г', 'h': 'х', 'i': 'и', 'j': 'й', 'k': 'к', 'l': 'л',
    'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р',
    's': 'с', 't': 'т', 'u': 'у', 'v': 'в', 'w': 'в', 'x': 'кс',
    'y': 'ы', 'z': 'з',
  };
  
  let result = name.toLowerCase();
  // Replace digraphs first
  result = result.replace(/sh/g, 'ш').replace(/ch/g, 'ч').replace(/zh/g, 'ж')
    .replace(/ya/g, 'я').replace(/yu/g, 'ю').replace(/yo/g, 'ё')
    .replace(/ts/g, 'ц').replace(/kh/g, 'х');
  
  // Then single letters
  result = result.split('').map(c => map[c] || c).join('');
  
  // Capitalize first letter of each word
  return result.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

// Extract deal ID from description like "Оплата по сделке 1767629480491(Клуб: триал итоги)"
function extractLeadIdFromDescription(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(/сделке\s+(\d+)/i);
  return match ? match[1] : null;
}

// Parse tariff type from description
function parseTariffFromDescription(description: string | null): { tariffType: string | null; isTrial: boolean } {
  if (!description) return { tariffType: null, isTrial: false };
  
  const descLower = description.toLowerCase();
  const isTrial = descLower.includes('триал') || descLower.includes('trial');
  
  // Extract tariff name from patterns like "(Клуб: триал итоги)" or "Gorbova Club - CHAT"
  if (descLower.includes('chat') || descLower.includes('чат')) {
    return { tariffType: 'CHAT', isTrial };
  }
  if (descLower.includes('full') || descLower.includes('итоги') || descLower.includes('полный')) {
    return { tariffType: 'FULL', isTrial };
  }
  if (descLower.includes('business') || descLower.includes('бизнес')) {
    return { tariffType: 'BUSINESS', isTrial };
  }
  if (descLower.includes('клуб') || descLower.includes('club')) {
    return { tariffType: 'CLUB', isTrial };
  }
  
  return { tariffType: null, isTrial };
}

// Extract offer_id from tracking_id format "{order_id}_{offer_id}"
function extractOfferIdFromTrackingId(trackingId: string | null): string | null {
  if (!trackingId) return null;
  const parts = trackingId.split('_');
  if (parts.length >= 2 && parts[1]?.length === 36) return parts[1];
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ========== INTERNAL KEY GUARD (PATCH-2) ==========
    // This function is for cron/internal use only
    const internalKey = req.headers.get('x-internal-key') || req.headers.get('X-Internal-Key');
    const expectedKey = Deno.env.get('CRON_SECRET');

    if (!expectedKey) {
      console.error('[bepaid-auto-process] CRON_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration', code: 'MISSING_CRON_SECRET' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (internalKey !== expectedKey) {
      console.warn('[bepaid-auto-process] Forbidden: invalid or missing x-internal-key');
      return new Response(
        JSON.stringify({ error: 'Forbidden', code: 'INVALID_INTERNAL_KEY' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ========== END INTERNAL KEY GUARD ==========

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { limit = 50, dryRun = false, queueItemId, createGhostProfiles = true } = body;

    console.log(`[BEPAID-AUTO-PROCESS] Starting with limit=${limit}, dryRun=${dryRun}, queueItemId=${queueItemId || 'none'}, createGhostProfiles=${createGhostProfiles}`);

    // Fetch pending queue items - support single item or batch
    let query = supabase
      .from('payment_reconcile_queue')
      .select('*');
    
    if (queueItemId) {
      // Process single item by ID
      query = query.eq('id', queueItemId);
    } else {
      // Retry rows abandoned in "processing" after a worker interruption.
      // Fresh processing rows stay excluded so concurrent workers cannot claim them.
      const staleProcessingCutoff = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString();
      query = query
        .or(
          `status.in.(pending,error),and(status.eq.processing,updated_at.lt.${staleProcessingCutoff})`,
        )
        .is('matched_order_id', null) // Skip already linked payments
        .lt('attempts', 5)
        .order('created_at', { ascending: true })
        .limit(limit);
    }

    const { data: queueItems, error: queueError } = await query;

    if (queueError) {
      throw new Error(`Failed to fetch queue: ${queueError.message}`);
    }

    console.log(`[BEPAID-AUTO-PROCESS] Found ${queueItems?.length || 0} items to process`);

    // Fetch ALL mappings for flexible matching
    const { data: allMappings } = await supabase
      .from('bepaid_product_mappings')
      .select('*');
    console.log(`[BEPAID-AUTO-PROCESS] Loaded ${allMappings?.length || 0} product mappings`);

    const results = {
      processed: 0,
      orders_created: 0,
      profiles_matched: 0,
      profiles_created: 0,
      refunds_linked: 0,
      skipped: 0,
      already_materialized: 0,
      orders_reconciled: 0,
      repaired_payments: 0,
      access_granted: 0,
      needs_review: 0,
      errors: [] as string[],
    };

    for (const item of queueItems || []) {
      try {
        console.log(`[BEPAID-AUTO-PROCESS] Processing item ${item.id}, bepaid_uid=${item.bepaid_uid}, transaction_type=${item.transaction_type}, description=${item.description}`);

        // Skip if already has matched order or is manually linked
        if (item.matched_order_id || item.status === 'manually_linked' || item.status === 'completed') {
          console.log(`[BEPAID-AUTO-PROCESS] Item already linked/completed (status=${item.status}, matched_order_id=${item.matched_order_id}), skipping`);
          results.skipped++;
          continue;
        }

        // =====================================================================
        // REFUND AUTO-LINKING: Find original payment for refund transactions
        // =====================================================================
        const isRefundTransaction = item.transaction_type === 'Возврат средств' || 
                                    item.transaction_type === 'refund';
        
        if (isRefundTransaction) {
          console.log(`[BEPAID-AUTO-PROCESS] Detected refund transaction, attempting to link to original payment`);
          
          let originalPayment = null;
          let linkedBy = null;
          
          // Method 1: Try reference_transaction_uid from raw_payload (webhook data)
          const refUid = item.reference_transaction_uid || 
                        item.raw_payload?.transaction?.parent_uid ||
                        item.raw_payload?.parent_uid;
          
          if (refUid) {
            const { data: paymentByRef } = await supabase
              .from('payments_v2')
              .select('id, order_id, profile_id, user_id, orders_v2:order_id(order_number, profile_id)')
              .eq('provider_payment_id', refUid)
              .maybeSingle();
            
            if (paymentByRef) {
              originalPayment = paymentByRef;
              linkedBy = 'reference_uid';
              console.log(`[BEPAID-AUTO-PROCESS] Found original payment by reference_uid: ${refUid}`);
            }
          }
          
          // Method 2: Try tracking_id match (e.g., lead_XXXXX)
          if (!originalPayment && item.tracking_id) {
            // Find original payment in queue or payments_v2 with same tracking_id but payment type
            const { data: paymentByTracking } = await supabase
              .from('payments_v2')
              .select('id, order_id, profile_id, user_id, orders_v2:order_id(order_number, profile_id)')
              .eq('meta->>tracking_id', item.tracking_id)
              .maybeSingle();
            
            if (paymentByTracking) {
              originalPayment = paymentByTracking;
              linkedBy = 'tracking_id';
              console.log(`[BEPAID-AUTO-PROCESS] Found original payment by tracking_id: ${item.tracking_id}`);
            }
            
            // Also check orders_v2 directly
            if (!originalPayment) {
              const { data: orderByTracking } = await supabase
                .from('orders_v2')
                .select('id, order_number, profile_id, user_id')
                .eq('meta->>tracking_id', item.tracking_id)
                .maybeSingle();
              
              if (orderByTracking) {
                // Find payment for this order
                const { data: paymentForOrder } = await supabase
                  .from('payments_v2')
                  .select('id, order_id, profile_id, user_id')
                  .eq('order_id', orderByTracking.id)
                  .limit(1)
                  .maybeSingle();
                
                if (paymentForOrder) {
                  originalPayment = { ...paymentForOrder, orders_v2: orderByTracking };
                  linkedBy = 'tracking_id_order';
                  console.log(`[BEPAID-AUTO-PROCESS] Found original order by tracking_id: ${orderByTracking.order_number}`);
                }
              }
            }
          }
          
          // Method 3: Match by email + similar amount + close date
          if (!originalPayment && item.customer_email && item.amount) {
            const refundDate = new Date(item.paid_at || item.created_at);
            const searchFrom = new Date(refundDate);
            searchFrom.setMonth(searchFrom.getMonth() - 3); // Look back 3 months
            
            const { data: paymentsByEmail } = await supabase
              .from('payments_v2')
              .select('id, order_id, amount, profile_id, user_id, paid_at, orders_v2:order_id(order_number, profile_id, customer_email)')
              .eq('status', 'succeeded')
              .gte('amount', (item.amount || 0) * 0.9)
              .lte('amount', (item.amount || 0) * 1.1)
              .gte('paid_at', searchFrom.toISOString())
              .lte('paid_at', refundDate.toISOString())
              .limit(10);
            
            // Find payment where order email matches
            if (paymentsByEmail?.length) {
              const matchingPayment = paymentsByEmail.find(p => 
                (p.orders_v2 as any)?.customer_email?.toLowerCase() === item.customer_email?.toLowerCase()
              );
              
              if (matchingPayment) {
                originalPayment = matchingPayment;
                linkedBy = 'email_amount_date';
                console.log(`[BEPAID-AUTO-PROCESS] Found original payment by email+amount+date match`);
              }
            }
          }
          
          // If we found original payment, link the refund
          if (originalPayment && !dryRun) {
            const orderId = originalPayment.order_id;
            const profileId = originalPayment.profile_id || (originalPayment.orders_v2 as any)?.profile_id;
            
            await supabase
              .from('payment_reconcile_queue')
              .update({
                matched_order_id: orderId,
                matched_profile_id: profileId,
                reference_transaction_uid: refUid || null,
                status: 'completed',
                processed_at: new Date().toISOString(),
                last_error: null,
              })
              .eq('id', item.id);
            
            // Log the link
            await supabase.from('audit_logs').insert({
              actor_user_id: null,
              actor_type: 'system',
              actor_label: 'bepaid-auto-process',
              action: 'refund_auto_linked',
              meta: {
                queue_item_id: item.id,
                refund_uid: item.bepaid_uid,
                original_payment_id: originalPayment.id,
                order_id: orderId,
                order_number: (originalPayment.orders_v2 as any)?.order_number,
                linked_by: linkedBy,
                amount: item.amount,
              },
            });
            
            results.refunds_linked++;
            results.processed++;
            console.log(`[BEPAID-AUTO-PROCESS] Refund ${item.bepaid_uid} linked to order ${(originalPayment.orders_v2 as any)?.order_number || orderId} by ${linkedBy}`);
            continue;
          } else if (originalPayment && dryRun) {
            console.log(`[BEPAID-AUTO-PROCESS] DRY RUN: Would link refund ${item.bepaid_uid} to order ${(originalPayment.orders_v2 as any)?.order_number}`);
            results.refunds_linked++;
            results.processed++;
            continue;
          } else {
            console.log(`[BEPAID-AUTO-PROCESS] Could not find original payment for refund ${item.bepaid_uid}, will try standard processing`);
          }
        }

        // Step 1: Find or match profile
        let profileId = item.matched_profile_id;
        let profileUserId: string | null = null;
        let matchedBy = null;
        const parsedTracking = parseBepaidTrackingId(item.tracking_id);
        let subscriptionContext: {
          id: string;
          profile_id: string | null;
          user_id: string | null;
          product_id: string | null;
          tariff_id: string | null;
          offer_id: string | null;
          order_id: string | null;
        } | null = null;

        // Recurring recoveries already carry the canonical subscriptions_v2 ID
        // in tracking_id. Resolve identity and catalog IDs from that record
        // before any fuzzy email/name/product matching.
        if (parsedTracking.subscriptionV2Id) {
          const { data: resolvedSubscription, error: subscriptionError } = await supabase
            .from('subscriptions_v2')
            .select('id, profile_id, user_id, product_id, tariff_id, order_id')
            .eq('id', parsedTracking.subscriptionV2Id)
            .maybeSingle();

          if (subscriptionError) {
            throw new Error(`Subscription resolver failed: ${subscriptionError.message}`);
          }

          if (resolvedSubscription) {
            let resolvedOfferId: string | null = null;
            if (resolvedSubscription.order_id) {
              const { data: sourceOrder } = await supabase
                .from('orders_v2')
                .select('offer_id')
                .eq('id', resolvedSubscription.order_id)
                .maybeSingle();
              resolvedOfferId = sourceOrder?.offer_id || null;
            }

            subscriptionContext = {
              ...resolvedSubscription,
              offer_id: resolvedOfferId,
            };
            profileId = profileId || resolvedSubscription.profile_id;
            // The profile is canonical for identity. Historical subscriptions
            // may carry a pre-migration/orphan user_id, so let the normal
            // profile loader below resolve the current user_id.
            profileUserId = null;
            matchedBy = 'subscription_tracking_id';
            console.log(
              `[BEPAID-AUTO-PROCESS] Resolved recurring context from subscription ${resolvedSubscription.id}`,
            );
          }
        }

        // 1a. Try email match
        if (!profileId && item.customer_email) {
          const { data: profileByEmail } = await supabase
            .from('profiles')
            .select('id, user_id')
            .eq('email', item.customer_email)
            .maybeSingle();
          
          if (profileByEmail) {
            profileId = profileByEmail.id;
            profileUserId = profileByEmail.user_id;
            matchedBy = 'email';
            console.log(`[BEPAID-AUTO-PROCESS] Matched by email: ${profileId}`);
          }
        }

        // 1b. Try card link match
        if (!profileId && item.card_last4 && item.card_holder) {
          const { data: cardLink } = await supabase
            .from('card_profile_links')
            .select('profile_id, profiles!inner(id, user_id)')
            .eq('card_last4', item.card_last4)
            .eq('card_holder', item.card_holder)
            .maybeSingle();
          
          if (cardLink) {
            profileId = cardLink.profile_id;
            profileUserId = (cardLink.profiles as any)?.user_id;
            matchedBy = 'card';
            console.log(`[BEPAID-AUTO-PROCESS] Matched by card: ${profileId}`);
          }
        }

        // 1c. Try transliterated name match
        if (!profileId && item.card_holder) {
          const translitName = transliterateToCyrillic(item.card_holder);
          const { data: profileByName } = await supabase
            .from('profiles')
            .select('id, user_id')
            .ilike('full_name', `%${translitName}%`)
            .maybeSingle();
          
          if (profileByName) {
            profileId = profileByName.id;
            profileUserId = profileByName.user_id;
            matchedBy = 'name_translit';
            console.log(`[BEPAID-AUTO-PROCESS] Matched by name translit: ${profileId}`);
          }
        }

        // 1d. Try to find deal by lead_id from description
        if (!profileId) {
          const leadId = extractLeadIdFromDescription(item.description);
          if (leadId) {
            // Search in orders_v2 by tracking_id or meta
            const { data: orderByLead } = await supabase
              .from('orders_v2')
              .select('id, profile_id, user_id')
              .eq('tracking_id', `lead_${leadId}`)
              .maybeSingle();
            
            if (orderByLead?.profile_id) {
              profileId = orderByLead.profile_id;
              profileUserId = orderByLead.user_id;
              matchedBy = 'lead_id';
              console.log(`[BEPAID-AUTO-PROCESS] Matched by lead_id from description: ${profileId}`);
            }
          }
        }

        // 1e. Create ghost profile ONLY if we have EMAIL (not from card_holder alone)
        // This prevents ghost contacts from being created from card holder names
        if (!profileId && createGhostProfiles && item.customer_email && !dryRun) {
          // Create profile from email, NOT from card_holder name
          const { data: newProfile, error: profileError } = await supabase
            .from('profiles')
            .insert({
              email: item.customer_email,
              phone: item.customer_phone,
              source: 'bepaid_import',
              // Note: full_name is intentionally NOT set from card_holder
            })
            .select('id')
            .single();
          
          if (profileError) {
            console.error(`[BEPAID-AUTO-PROCESS] Failed to create ghost profile: ${profileError.message}`);
          } else {
            profileId = newProfile.id;
            matchedBy = 'ghost_created';
            results.profiles_created++;
            console.log(`[BEPAID-AUTO-PROCESS] Created ghost profile from email: ${profileId} (${item.customer_email})`);
            
            // Save card link for future (for matching, but NOT for name)
            if (item.card_last4 && item.card_holder) {
              await supabase.from('card_profile_links').upsert({
                card_last4: item.card_last4,
                card_holder: item.card_holder,
                card_brand: item.card_brand,
                profile_id: profileId,
              }, {
                onConflict: 'card_last4,card_brand',
                ignoreDuplicates: true,
              });
            }
          }
        }

        // Get user_id and email if we have profile but not user_id yet
        let profileEmail: string | null = null;
        if (profileId && !profileUserId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('user_id, email')
            .eq('id', profileId)
            .maybeSingle();
          profileUserId = profile?.user_id;
          profileEmail = profile?.email || null;
        }
        
        // Also fetch email even if we already have user_id
        if (profileId && !profileEmail) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', profileId)
            .maybeSingle();
          profileEmail = profileData?.email || null;
        }

        if (profileId && !item.matched_profile_id) {
          results.profiles_matched++;
          
          if (!dryRun) {
            // Update queue item with matched profile
            await supabase
              .from('payment_reconcile_queue')
              .update({ matched_profile_id: profileId })
              .eq('id', item.id);

            // Save card link for future (if not ghost created)
            if (matchedBy !== 'card' && matchedBy !== 'ghost_created' && item.card_last4 && item.card_holder) {
              await supabase.from('card_profile_links').upsert({
                card_last4: item.card_last4,
                card_holder: item.card_holder,
                card_brand: item.card_brand,
                profile_id: profileId,
              }, {
                onConflict: 'card_last4,card_brand',
                ignoreDuplicates: true,
              });
            }
          }
        }

        // Step 2: Find product mapping - PRIORITY: offer_id > plan_title > fuzzy
        let mapping = null;
        const planTitle = item.product_name || item.tariff_name;

        // 2a. CANONICAL recurring resolution: the active subscription is the
        // source of truth for product/tariff/offer. Prefer an existing mapping,
        // but synthesize the minimal writer context when plan-title mappings
        // are absent or stale.
        if (subscriptionContext?.product_id && subscriptionContext?.tariff_id) {
          mapping = (allMappings || []).find((candidate) =>
            candidate.product_id === subscriptionContext!.product_id &&
            candidate.tariff_id === subscriptionContext!.tariff_id &&
            (!subscriptionContext!.offer_id || candidate.offer_id === subscriptionContext!.offer_id)
          ) || {
            product_id: subscriptionContext.product_id,
            tariff_id: subscriptionContext.tariff_id,
            offer_id: subscriptionContext.offer_id,
            auto_create_order: true,
            bepaid_plan_title: 'resolved_from_subscriptions_v2',
          };
          console.log(
            `[BEPAID-AUTO-PROCESS] Matched recurring catalog from subscriptions_v2: product=${subscriptionContext.product_id}, tariff=${subscriptionContext.tariff_id}`,
          );
        }
        
        // 2b. PRIORITY 1: Extract offer_id from tracking_id
        const offerIdFromTracking = extractOfferIdFromTrackingId(item.tracking_id);
        if (!mapping && offerIdFromTracking) {
          mapping = (allMappings || []).find(m => m.offer_id === offerIdFromTracking);
          if (mapping) {
            console.log(`[BEPAID-AUTO-PROCESS] Matched by offer_id from tracking_id: ${offerIdFromTracking}`);
          }
        }
        
        // 2c. PRIORITY 2: Try exact match by plan_title (только если offer_id не найден)
        if (!mapping && planTitle) {
          mapping = (allMappings || []).find(m => 
            m.bepaid_plan_title === planTitle ||
            m.bepaid_description === planTitle
          );
          if (mapping) {
            console.log(`[BEPAID-AUTO-PROCESS] Found exact mapping for: ${planTitle}`);
          }
        }
        
        // 2d. PRIORITY 3: Try fuzzy match on description
        if (!mapping && item.description) {
          const { tariffType, isTrial } = parseTariffFromDescription(item.description);
          console.log(`[BEPAID-AUTO-PROCESS] Parsed description: tariffType=${tariffType}, isTrial=${isTrial}`);
          
          // Find mapping by tariff type and trial status
          if (tariffType) {
            mapping = (allMappings || []).find(m => {
              const titleLower = (m.bepaid_plan_title || '').toLowerCase();
              const descLower = (m.bepaid_description || '').toLowerCase();
              
              // Check if mapping matches tariff type
              const matchesTariff = titleLower.includes(tariffType.toLowerCase()) ||
                descLower.includes(tariffType.toLowerCase());
              
              // Check trial status
              const mappingIsTrial = titleLower.includes('trial') || descLower.includes('trial');
              
              return matchesTariff && (isTrial === mappingIsTrial);
            });
            
            if (mapping) {
              console.log(`[BEPAID-AUTO-PROCESS] Found fuzzy mapping: ${mapping.bepaid_plan_title}`);
            }
          }
        }

        // 2e. PATCH-ID-FIRST: If still no mapping, try to resolve by tracking_id order → product_id
        // Instead of text-matching 'клуб'/'club', use ID-based resolution
        if (!mapping && item.tracking_id) {
          // Extract order_id from tracking_id formats: "link:order:{uuid}" or "{order_uuid}_{offer_uuid}"
          let fallbackOrderId: string | null = null;
          const linkMatch = item.tracking_id.match(/link:order:([0-9a-f-]+)/i);
          if (linkMatch) {
            fallbackOrderId = linkMatch[1];
          } else {
            const uuidMatch = item.tracking_id.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (uuidMatch) fallbackOrderId = uuidMatch[1];
          }
          
          if (fallbackOrderId) {
            const { data: orderForMapping } = await supabase
              .from('orders_v2')
              .select('product_id, tariff_id')
              .eq('id', fallbackOrderId)
              .maybeSingle();
            
            if (orderForMapping?.product_id) {
              // Find mapping by product_id (ID-first, not text)
              mapping = (allMappings || []).find(m => m.product_id === orderForMapping.product_id);
              if (mapping) {
                console.log(`[BEPAID-AUTO-PROCESS] PATCH-ID-FIRST: Matched by order→product_id: ${orderForMapping.product_id}`);
              }
            }
          }
        }

        // 2f. Legacy fallback: description-based club matching (deprecated, for unlinked historical transactions only)
        if (!mapping && item.description) {
          const descLower = item.description.toLowerCase();
          if (descLower.includes('клуб') || descLower.includes('club')) {
            mapping = (allMappings || []).find(m => {
              const titleLower = (m.bepaid_plan_title || '').toLowerCase();
              return titleLower.includes('club') || titleLower.includes('клуб');
            });
            if (mapping) {
              console.log(`[BEPAID-AUTO-PROCESS] DEPRECATED legacy club text-match: ${mapping.bepaid_plan_title}. Should be resolved by ID.`);
            }
          }
        }

        // Step 3: CRITICAL - Check if payment with this bepaid_uid already exists (PREVENT DUPLICATES)
        if (item.bepaid_uid) {
          const { data: existingPayment } = await supabase
            .from('payments_v2')
            .select('id, order_id, orders_v2:order_id(order_number)')
            .eq('provider', 'bepaid')
            .eq('provider_payment_id', item.bepaid_uid)
            .maybeSingle();
          
          if (existingPayment?.order_id) {
            const existingOrderNumber = (existingPayment as any).orders_v2?.order_number || 'N/A';
            console.warn(`[BEPAID-AUTO-PROCESS] RECONCILE: Payment with bepaid_uid=${item.bepaid_uid} already exists (payment_id=${existingPayment.id}, order_id=${existingPayment.order_id}, order_number=${existingOrderNumber})`);
            
            if (!dryRun) {
              await grantCanonicalAccess(supabase, existingPayment.order_id);
              results.access_granted++;
              await supabase
                .from('payment_reconcile_queue')
                .update({ 
                  matched_order_id: existingPayment.order_id,
                  status: 'completed',
                  processed_at: new Date().toISOString(),
                  last_error: `payment_already_exists: existing_payment_id=${existingPayment.id}, existing_order_id=${existingPayment.order_id}, existing_order_number=${existingOrderNumber}`,
                })
                .eq('id', item.id);
            }
            
            results.skipped++;
            results.already_materialized++;
            results.orders_reconciled++;
            (results as any).skipReasons = (results as any).skipReasons || [];
            (results as any).skipReasons.push({
              bepaid_uid: item.bepaid_uid,
              reason: 'payment_already_exists',
              existing_payment_id: existingPayment.id,
              existing_order_id: existingPayment.order_id,
              existing_order_number: existingOrderNumber,
            });
            continue;
          } else if (existingPayment) {
            console.warn(`[BEPAID-AUTO-PROCESS] REPAIR: Payment ${existingPayment.id} exists without order; continuing canonical reconciliation`);
          }
        }

        // Step 3b: Check if order already exists by tracking_id or bepaid_uid in meta
        let existingOrder = null;
        if (item.tracking_id) {
          const { data } = await supabase
            .from('orders_v2')
            .select('id, order_number, profile_id, final_price, currency')
            .eq('meta->>tracking_id', item.tracking_id)
            .maybeSingle();
          existingOrder = data;
        }
        
        if (!existingOrder && item.bepaid_uid) {
          const { data } = await supabase
            .from('orders_v2')
            .select('id, order_number, profile_id, final_price, currency')
            .contains('purchase_snapshot', { bepaid_uid: item.bepaid_uid })
            .maybeSingle();
          existingOrder = data;
        }

        if (existingOrder) {
          console.log(`[BEPAID-AUTO-PROCESS] Order already exists: ${existingOrder.order_number}`);
          
          if (!dryRun) {
            const existingPaidAt = item.paid_at || item.created_at_bepaid || item.created_at;
            const persistedPayment = await ensureCanonicalPayment(
              supabase,
              item,
              existingOrder,
              profileId,
              existingPaidAt,
            );
            if (persistedPayment.repaired_orphan) results.repaired_payments++;
            await grantCanonicalAccess(supabase, existingOrder.id);
            results.access_granted++;
            await supabase
              .from('payment_reconcile_queue')
              .update({ 
                matched_order_id: existingOrder.id,
                status: 'completed',
                processed_at: new Date().toISOString(),
              })
              .eq('id', item.id);
          }
          
          results.skipped++;
          results.already_materialized++;
          results.orders_reconciled++;
          continue;
        }

        // Step 4: Determine amount - use offer price if queue amount is trial/minimal
        let finalAmount = item.amount || 0;
        if (mapping?.offer_id && (finalAmount === 0 || finalAmount <= 10)) {
          const { data: offer } = await supabase
            .from('tariff_offers')
            .select('amount')
            .eq('id', mapping.offer_id)
            .maybeSingle();
          if (offer?.amount && offer.amount > finalAmount) {
            console.log(`[BEPAID-AUTO-PROCESS] Using offer amount: ${offer.amount} instead of ${finalAmount}`);
            // Keep the actual payment amount, don't override with offer price
            // The offer price is for reference, actual payment is what we record
          }
        }

        // Step 5: Create order if we have profile and mapping allows auto-create
        if (profileId && mapping?.auto_create_order && !dryRun) {
          // Generate order number
          const year = new Date().getFullYear().toString().slice(-2);
          const { count } = await supabase
            .from('orders_v2')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', `${new Date().getFullYear()}-01-01`);
          
          const orderNumber = `ORD-${year}-${String((count || 0) + 1).padStart(5, '0')}`;

          // Use REAL payment date, not import date
          const paidAt = item.paid_at || item.created_at_bepaid || item.created_at;

          // Prepare customer data for meta
          const customerFullName = [item.customer_name, item.customer_surname].filter(Boolean).join(' ') || 
            (item.card_holder ? transliterateToCyrillic(item.card_holder) : null);

          // Use profile email as fallback if item doesn't have email
          const orderCustomerEmail = item.customer_email || profileEmail;

          // Create order with ALL customer data in meta
          // NOTE: tracking_id and payment_method columns don't exist in orders_v2, store in meta/purchase_snapshot
          const { data: newOrder, error: orderError } = await supabase
            .from('orders_v2')
            .insert({
              profile_id: profileId,
              user_id: profileUserId,
              product_id: mapping.product_id,
              tariff_id: mapping.tariff_id,
              offer_id: mapping.offer_id,
              order_number: orderNumber,
              status: 'paid',
              base_price: finalAmount,
              final_price: finalAmount,
              currency: item.currency || 'BYN',
              customer_email: orderCustomerEmail,
              reconcile_source: 'bepaid_auto',
              created_at: paidAt,  // Use payment date, not now()
              purchase_snapshot: buildPurchaseSnapshot({
                product_id: mapping.product_id,
                tariff_id: mapping.tariff_id,
                offer_id: mapping.offer_id,
                price: finalAmount,
                currency: item.currency || 'BYN',
                reconcile_source: 'bepaid_auto',
                extra: {
                  bepaid_uid: item.bepaid_uid,
                  tracking_id: item.tracking_id,
                  payment_method: 'bepaid',
                  source: 'auto_process',
                  imported_at: new Date().toISOString(),
                  card_last4: item.card_last4,
                  card_holder: item.card_holder,
                },
              }),
              meta: {
                customer_name: item.customer_name,
                customer_surname: item.customer_surname,
                customer_full_name: customerFullName,
                customer_email: orderCustomerEmail,
                customer_phone: item.customer_phone,
                card_holder: item.card_holder,
                card_holder_translit: item.card_holder ? transliterateToCyrillic(item.card_holder) : null,
                ip_address: item.ip_address,
                purchased_at: paidAt,
                imported_at: new Date().toISOString(),
                offer_id: mapping.offer_id,
                description: item.description,
                match_type: matchedBy,
              },
            })
            .select('id, order_number')
            .single();

          if (orderError) {
            throw new Error(`Failed to create order: ${orderError.message}`);
          }

          console.log(`[BEPAID-AUTO-PROCESS] Created order: ${newOrder.order_number}`);

          // Persist and verify the canonical payment before any queue success.
          const persistedPayment = await ensureCanonicalPayment(supabase, item, newOrder, profileId, paidAt);
          if (persistedPayment.repaired_orphan) results.repaired_payments++;

          // Calculate access period (used for both subscription and entitlement)
          let trialDays = 0;
          let accessDays = 30;
          
          if (mapping.offer_id) {
            const { data: offer } = await supabase
              .from('tariff_offers')
              .select('offer_type, trial_days, access_days')
              .eq('id', mapping.offer_id)
              .maybeSingle();
            
            if (offer?.offer_type === 'trial' && offer.trial_days) {
              trialDays = offer.trial_days;
              accessDays = offer.trial_days;
            } else if (offer?.access_days) {
              accessDays = offer.access_days;
            }
          }
          
          const startDate = new Date(paidAt);
          const endDate = new Date(startDate.getTime() + accessDays * 24 * 60 * 60 * 1000);

          // CANONICAL FULFILLMENT: delegate ALL access grants to grant-access-for-order
          // This replaces:
          // 1. Conditional grant-access (was only for is_subscription)
          // 2. Direct entitlement INSERT/UPDATE by product_code (was for ALL cases)
          // 3. Direct entitlement_orders INSERT (now handled by canonical flow)
          // Post-grant direct writes are PROHIBITED — they overwrite canonical access_rule_id
          const grantResult = await grantCanonicalAccess(supabase, newOrder.id, accessDays);
          results.access_granted++;
          console.log(`[BEPAID-AUTO-PROCESS] grant-access-for-order success for order ${newOrder.id}:`, grantResult);

          // === NOTIFY ADMINS ABOUT NEW ORDER ===
          try {
            // Get customer profile for notification
            const { data: customerProfile } = await supabase
              .from('profiles')
              .select('full_name, email, telegram_username')
              .eq('id', profileId)
              .single();

            // Get product name
            const { data: productInfo } = await supabase
              .from('products_v2')
              .select('name')
              .eq('id', mapping.product_id)
              .single();

            // Get tariff name
            const { data: tariffInfo } = await supabase
              .from('tariffs')
              .select('name')
              .eq('id', mapping.tariff_id)
              .single();

            const notifyMessage = buildAdminNotifyMessage({
              operation_type: 'auto_payment',
              client_name: customerProfile?.full_name || item.card_holder,
              email: customerProfile?.email || item.customer_email,
              telegram_username: customerProfile?.telegram_username,
              product_name: productInfo?.name,
              tariff_name: tariffInfo?.name,
              amount: finalAmount,
              currency: item.currency || 'BYN',
              
              source_label: 'Автообработка',
            });

            await supabase.functions.invoke('telegram-notify-admins', {
              body: { message: notifyMessage },
            });

            console.log(`[BEPAID-AUTO-PROCESS] Admin notification sent for order ${newOrder.order_number}`);
          } catch (notifyError) {
            console.error(`[BEPAID-AUTO-PROCESS] Admin notification failed:`, notifyError);
            // Don't fail the process if notification fails
          }

          // GetCourse sync - call the unified function (best-effort, non-blocking)
          if (orderCustomerEmail && mapping.offer_id) {
            try {
              const gcResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/getcourse-grant-access`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({ order_id: newOrder.id }),
              });
              
              // Parse response but don't fail on non-2xx (GC sync is optional)
              if (gcResponse.ok) {
                const gcResult = await gcResponse.json().catch(() => ({}));
                console.log(`[BEPAID-AUTO-PROCESS] GC sync result:`, gcResult);
              } else {
                console.warn(`[BEPAID-AUTO-PROCESS] GC sync returned ${gcResponse.status} - ignoring (best-effort)`);
              }
            } catch (gcErr) {
              // GC sync failure should NOT block payment processing
              console.error(`[BEPAID-AUTO-PROCESS] GC sync error (non-blocking):`, gcErr);
            }
          }

          // Update queue item
          await supabase
            .from('payment_reconcile_queue')
            .update({
              matched_order_id: newOrder.id,
              matched_profile_id: profileId,
              matched_product_id: mapping.product_id,
              matched_tariff_id: mapping.tariff_id,
              status: 'completed',
              processed_at: new Date().toISOString(),
            })
            .eq('id', item.id);

          results.orders_created++;
        } else {
          // Cannot auto-create - update with reason
          if (!dryRun) {
            let errorReason = 'unknown';
            if (!profileId) errorReason = 'no_profile_match';
            else if (!mapping) errorReason = 'no_product_mapping';
            else if (!mapping.auto_create_order) errorReason = 'auto_create_disabled';
            
            await supabase
              .from('payment_reconcile_queue')
              .update({
                matched_profile_id: profileId,
                status: 'error',
                last_error: errorReason,
                attempts: (item.attempts || 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.id);
          }
          results.skipped++;
          results.needs_review++;
        }

        results.processed++;
      } catch (err: any) {
        console.error(`[BEPAID-AUTO-PROCESS] Error processing item ${item.id}:`, err);
        results.errors.push(`${item.id}: ${err.message}`);
        
        if (!dryRun) {
          await supabase
            .from('payment_reconcile_queue')
            .update({ 
              status: 'error',
              last_error: err.message,
              attempts: (item.attempts || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id);
        }
      }
    }

    console.log(`[BEPAID-AUTO-PROCESS] Completed:`, results);

    return new Response(JSON.stringify({
      success: true,
      results,
      dryRun,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[BEPAID-AUTO-PROCESS] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
