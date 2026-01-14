import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      // Process batch of pending items
      query = query
        .in('status', ['pending', 'error'])
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
      skipped: 0,
      errors: [] as string[],
    };

    for (const item of queueItems || []) {
      try {
        console.log(`[BEPAID-AUTO-PROCESS] Processing item ${item.id}, bepaid_uid=${item.bepaid_uid}, description=${item.description}`);

        // Skip if already has matched order
        if (item.matched_order_id && item.status === 'completed') {
          console.log(`[BEPAID-AUTO-PROCESS] Item already completed with order, skipping`);
          results.skipped++;
          continue;
        }

        // Step 1: Find or match profile
        let profileId = item.matched_profile_id;
        let profileUserId: string | null = null;
        let matchedBy = null;

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

        // 1e. Create ghost profile if we have card_holder but no match
        if (!profileId && createGhostProfiles && item.card_holder && !dryRun) {
          const translitName = transliterateToCyrillic(item.card_holder);
          const ghostEmail = item.customer_email || null;
          
          // Create profile without user_id (will be linked when user registers)
          const { data: newProfile, error: profileError } = await supabase
            .from('profiles')
            .insert({
              full_name: translitName,
              email: ghostEmail,
              phone: item.customer_phone,
              source: 'bepaid_import',
            })
            .select('id')
            .single();
          
          if (profileError) {
            console.error(`[BEPAID-AUTO-PROCESS] Failed to create ghost profile: ${profileError.message}`);
          } else {
            profileId = newProfile.id;
            matchedBy = 'ghost_created';
            results.profiles_created++;
            console.log(`[BEPAID-AUTO-PROCESS] Created ghost profile: ${profileId} (${translitName})`);
            
            // Save card link for future
            if (item.card_last4) {
              await supabase.from('card_profile_links').upsert({
                card_last4: item.card_last4,
                card_holder: item.card_holder,
                card_brand: item.card_brand,
                profile_id: profileId,
              }, {
                onConflict: 'card_last4,card_holder',
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
                onConflict: 'card_last4,card_holder',
                ignoreDuplicates: true,
              });
            }
          }
        }

        // Step 2: Find product mapping - PRIORITY: offer_id > plan_title > fuzzy
        let mapping = null;
        const planTitle = item.product_name || item.tariff_name;
        
        // 2a. PRIORITY 1: Extract offer_id from tracking_id
        const offerIdFromTracking = extractOfferIdFromTrackingId(item.tracking_id);
        if (offerIdFromTracking) {
          mapping = (allMappings || []).find(m => m.offer_id === offerIdFromTracking);
          if (mapping) {
            console.log(`[BEPAID-AUTO-PROCESS] Matched by offer_id from tracking_id: ${offerIdFromTracking}`);
          }
        }
        
        // 2b. PRIORITY 2: Try exact match by plan_title (только если offer_id не найден)
        if (!mapping && planTitle) {
          mapping = (allMappings || []).find(m => 
            m.bepaid_plan_title === planTitle ||
            m.bepaid_description === planTitle
          );
          if (mapping) {
            console.log(`[BEPAID-AUTO-PROCESS] Found exact mapping for: ${planTitle}`);
          }
        }
        
        // 2c. PRIORITY 3: Try fuzzy match on description
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

        // 2c. If still no mapping but has description with "Клуб", try generic club mapping
        if (!mapping && item.description) {
          const descLower = item.description.toLowerCase();
          if (descLower.includes('клуб') || descLower.includes('club')) {
            // Get first available club mapping
            mapping = (allMappings || []).find(m => {
              const titleLower = (m.bepaid_plan_title || '').toLowerCase();
              return titleLower.includes('club') || titleLower.includes('клуб');
            });
            if (mapping) {
              console.log(`[BEPAID-AUTO-PROCESS] Found generic club mapping: ${mapping.bepaid_plan_title}`);
            }
          }
        }

        // Step 3: CRITICAL - Check if payment with this bepaid_uid already exists (PREVENT DUPLICATES)
        if (item.bepaid_uid) {
          const { data: existingPayment } = await supabase
            .from('payments_v2')
            .select('id, order_id, orders_v2:order_id(order_number)')
            .eq('provider_payment_id', item.bepaid_uid)
            .maybeSingle();
          
          if (existingPayment) {
            const existingOrderNumber = (existingPayment as any).orders_v2?.order_number || 'N/A';
            console.warn(`[BEPAID-AUTO-PROCESS] SKIP: Payment with bepaid_uid=${item.bepaid_uid} already exists (payment_id=${existingPayment.id}, order_id=${existingPayment.order_id}, order_number=${existingOrderNumber})`);
            
            if (!dryRun) {
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
            (results as any).skipReasons = (results as any).skipReasons || [];
            (results as any).skipReasons.push({
              bepaid_uid: item.bepaid_uid,
              reason: 'payment_already_exists',
              existing_payment_id: existingPayment.id,
              existing_order_id: existingPayment.order_id,
              existing_order_number: existingOrderNumber,
            });
            continue;
          }
        }

        // Step 3b: Check if order already exists by tracking_id or bepaid_uid in meta
        let existingOrder = null;
        if (item.tracking_id) {
          const { data } = await supabase
            .from('orders_v2')
            .select('id, order_number')
            .eq('tracking_id', item.tracking_id)
            .maybeSingle();
          existingOrder = data;
        }
        
        if (!existingOrder && item.bepaid_uid) {
          const { data } = await supabase
            .from('orders_v2')
            .select('id, order_number')
            .contains('purchase_snapshot', { bepaid_uid: item.bepaid_uid })
            .maybeSingle();
          existingOrder = data;
        }

        if (existingOrder) {
          console.log(`[BEPAID-AUTO-PROCESS] Order already exists: ${existingOrder.order_number}`);
          
          if (!dryRun) {
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
          const { data: newOrder, error: orderError } = await supabase
            .from('orders_v2')
            .insert({
              profile_id: profileId,
              user_id: profileUserId,
              product_id: mapping.product_id,
              tariff_id: mapping.tariff_id,
              offer_id: mapping.offer_id,
              order_number: orderNumber,
              tracking_id: item.tracking_id,
              status: 'paid',
              final_price: finalAmount,
              currency: item.currency || 'BYN',
              payment_method: 'bepaid',
              customer_email: orderCustomerEmail,
              purchase_snapshot: {
                bepaid_uid: item.bepaid_uid,
                source: 'auto_process',
                imported_at: new Date().toISOString(),
                card_last4: item.card_last4,
                card_holder: item.card_holder,
              },
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

          // Create payment record with REAL payment date
          await supabase.from('payments_v2').insert({
            order_id: newOrder.id,
            profile_id: profileId,
            amount: finalAmount,
            currency: item.currency || 'BYN',
            status: 'succeeded',
            provider: 'bepaid',
            provider_payment_id: item.bepaid_uid,
            payment_method: 'card',
            paid_at: paidAt, // Use real payment date!
            provider_response: {
              card_last4: item.card_last4,
              card_holder: item.card_holder,
              card_brand: item.card_brand,
            },
            meta: {
              customer_full_name: customerFullName,
              customer_email: item.customer_email,
              customer_phone: item.customer_phone,
              ip_address: item.ip_address,
              description: item.description,
            },
          });

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

          // Create subscription if needed - use correct column names!
          if (mapping.is_subscription && profileUserId) {
            await supabase.from('subscriptions_v2').insert({
              user_id: profileUserId,
              profile_id: profileId,
              order_id: newOrder.id,
              product_id: mapping.product_id,
              tariff_id: mapping.tariff_id,
              status: 'active',
              access_start_at: startDate.toISOString(),
              access_end_at: endDate.toISOString(),
              next_charge_at: trialDays > 0 ? endDate.toISOString() : null,
              auto_renew: trialDays === 0,
            });
          }

          // Create/Update entitlement with GREATEST(expires_at) + entitlement_orders link
          const { data: product } = await supabase
            .from('products_v2')
            .select('code')
            .eq('id', mapping.product_id)
            .maybeSingle();

          if (product?.code && profileUserId) {
            const productCode = product.code;
            
            // Check if entitlement_orders already has this order
            const { data: existingEO } = await supabase
              .from('entitlement_orders')
              .select('id')
              .eq('order_id', newOrder.id)
              .maybeSingle();

            if (!existingEO) {
              // Check for existing entitlement for this user+product
              const { data: existingEntitlement } = await supabase
                .from('entitlements')
                .select('id, expires_at')
                .eq('user_id', profileUserId)
                .eq('product_code', productCode)
                .maybeSingle();

              let entitlementId: string;
              const newExpiresAt = endDate.toISOString();

              if (existingEntitlement) {
                // Update with GREATEST(expires_at)
                const currentExpires = existingEntitlement.expires_at ? new Date(existingEntitlement.expires_at) : new Date(0);
                const newExpires = new Date(newExpiresAt);
                const finalExpires = currentExpires > newExpires ? currentExpires : newExpires;

                await supabase
                  .from('entitlements')
                  .update({
                    expires_at: finalExpires.toISOString(),
                    status: 'active',
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existingEntitlement.id);

                entitlementId = existingEntitlement.id;
                console.log(`[BEPAID-AUTO-PROCESS] Updated entitlement ${entitlementId} expires_at: ${finalExpires.toISOString()}`);
              } else {
                // Insert new entitlement
                const { data: newEntitlement, error: entError } = await supabase
                  .from('entitlements')
                  .insert({
                    user_id: profileUserId,
                    profile_id: profileId,
                    order_id: newOrder.id,
                    product_code: productCode,
                    status: 'active',
                    expires_at: newExpiresAt,
                    meta: { source: 'bepaid_auto_process', match_type: matchedBy },
                  })
                  .select('id')
                  .single();

                if (entError) {
                  console.error(`[BEPAID-AUTO-PROCESS] Entitlement insert failed:`, entError);
                  throw new Error(`Entitlement failed: ${entError.message}`);
                }
                entitlementId = newEntitlement.id;
                console.log(`[BEPAID-AUTO-PROCESS] Created entitlement ${entitlementId}`);
              }

              // Link order → entitlement in entitlement_orders
              await supabase
                .from('entitlement_orders')
                .insert({
                  order_id: newOrder.id,
                  entitlement_id: entitlementId,
                  user_id: profileUserId,
                  product_code: productCode,
                  meta: {
                    source: 'bepaid_auto_process',
                    match_type: matchedBy,
                    access_end_at: newExpiresAt,
                  },
                });
              console.log(`[BEPAID-AUTO-PROCESS] Linked order ${newOrder.id} → entitlement ${entitlementId}`);
            }
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
