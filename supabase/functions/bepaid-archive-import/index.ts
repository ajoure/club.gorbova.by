import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Parse description to extract deal ID and product name
function parseDescription(description: string): { dealId: string | null; productName: string } {
  if (!description) return { dealId: null, productName: "" };
  
  // Pattern: "Оплата по сделке 30354989 (Gorbova Club)"
  const match = description.match(/сделке\s+(\d+)\s*\(([^)]+)\)/i);
  if (match) {
    return {
      dealId: match[1],
      productName: match[2].trim(),
    };
  }
  
  // Pattern: "Оплата по сделке 12345678" without brackets
  const dealOnlyMatch = description.match(/сделке\s+(\d+)/i);
  if (dealOnlyMatch) {
    return {
      dealId: dealOnlyMatch[1],
      productName: description,
    };
  }
  
  return { dealId: null, productName: description };
}

// Transliterate Latin to Cyrillic for name matching
function transliterateToСyrillic(latinName: string): string {
  if (!latinName) return "";
  
  const TRANSLIT_MAP: Record<string, string> = {
    'SHCH': 'Щ', 'shch': 'щ',
    'YA': 'Я', 'ya': 'я', 'IA': 'Я', 'ia': 'я',
    'YU': 'Ю', 'yu': 'ю', 'IU': 'Ю', 'iu': 'ю',
    'YE': 'Е', 'ye': 'е', 'IE': 'Е', 'ie': 'е',
    'ZH': 'Ж', 'zh': 'ж',
    'KH': 'Х', 'kh': 'х',
    'TS': 'Ц', 'ts': 'ц',
    'CH': 'Ч', 'ch': 'ч',
    'SH': 'Ш', 'sh': 'ш',
    'A': 'А', 'a': 'а', 'B': 'Б', 'b': 'б',
    'V': 'В', 'v': 'в', 'W': 'В', 'w': 'в',
    'G': 'Г', 'g': 'г', 'H': 'Г', 'h': 'г',
    'D': 'Д', 'd': 'д', 'E': 'Е', 'e': 'е',
    'Z': 'З', 'z': 'з', 'I': 'И', 'i': 'и',
    'Y': 'Й', 'y': 'й', 'K': 'К', 'k': 'к',
    'L': 'Л', 'l': 'л', 'M': 'М', 'm': 'м',
    'N': 'Н', 'n': 'н', 'O': 'О', 'o': 'о',
    'P': 'П', 'p': 'п', 'R': 'Р', 'r': 'р',
    'S': 'С', 's': 'с', 'T': 'Т', 't': 'т',
    'U': 'У', 'u': 'у', 'F': 'Ф', 'f': 'ф',
    'C': 'Ц', 'c': 'ц',
  };
  
  let result = latinName;
  const sortedKeys = Object.keys(TRANSLIT_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const regex = new RegExp(key, 'g');
    result = result.replace(regex, TRANSLIT_MAP[key]);
  }
  return result;
}

interface ManualMapping {
  customName: string | null;
  productId: string | null;
  action: "manual" | "existing" | "auto";
}

interface ImportStats {
  processed: number;
  ordersCreated: number;
  paymentsCreated: number;
  profilesCreated: number;
  profilesMatched: number;
  skipped: number;
  errors: string[];
  refundsProcessed: number;
  productsAutoCreated: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      batchSize = 100, 
      dryRun = false, 
      onlyMapped = false,
      manualMappings = {} as Record<string, ManualMapping>,
    } = await req.json();

    console.log(`Starting bePaid archive import: batchSize=${batchSize}, dryRun=${dryRun}, onlyMapped=${onlyMapped}`);
    console.log(`Manual mappings provided: ${Object.keys(manualMappings).length}`);

    // Get pending queue items
    const query = supabase
      .from("payment_reconcile_queue")
      .select("*")
      .eq("status", "pending")
      .order("paid_at", { ascending: true })
      .limit(batchSize);

    const { data: queueItems, error: queueError } = await query;
    if (queueError) throw queueError;

    console.log(`Found ${queueItems?.length || 0} pending queue items`);

    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending items to process", stats: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load existing product mappings
    const { data: mappings } = await supabase
      .from("bepaid_product_mappings")
      .select("bepaid_plan_title, product_id, tariff_id, offer_id, is_subscription, auto_create_order");

    const mappingsMap = new Map(
      (mappings || []).map(m => [m.bepaid_plan_title?.toLowerCase(), m])
    );

    // Load all products for potential matching
    const { data: existingProducts } = await supabase
      .from("products_v2")
      .select("id, name, code");
    
    const productsMap = new Map(
      (existingProducts || []).map(p => [p.id, p])
    );

    // Load all profiles for matching
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, email, full_name, phone, card_masks, card_holder_names");

    const profilesByEmail = new Map<string, any>();
    const profilesByPhone = new Map<string, any>();
    const profilesByCardMask = new Map<string, any>();

    (profiles || []).forEach(p => {
      if (p.email) profilesByEmail.set(p.email.toLowerCase(), p);
      if (p.phone) profilesByPhone.set(p.phone.replace(/\D/g, ''), p);
      const cardMasks = p.card_masks as string[] || [];
      cardMasks.forEach(mask => profilesByCardMask.set(mask, p));
    });

    // Cache for auto-created products (to avoid duplicate creates)
    const autoCreatedProducts = new Map<string, string>(); // productName -> productId

    const stats: ImportStats = {
      processed: 0,
      ordersCreated: 0,
      paymentsCreated: 0,
      profilesCreated: 0,
      profilesMatched: 0,
      skipped: 0,
      errors: [],
      refundsProcessed: 0,
      productsAutoCreated: 0,
    };

    for (const item of queueItems) {
      try {
        stats.processed++;
        
        const payload = item.raw_payload as Record<string, any> || {};
        const plan = payload.plan || {};
        const additionalData = payload.additional_data || {};

        // Get description and parse it
        const description = item.description || additionalData.description || plan.title || "";
        const { dealId, productName } = parseDescription(description);
        
        // Get plan title for mapping lookup
        const planTitle = plan.title || plan.name || productName || "";
        const planTitleLower = planTitle.toLowerCase();
        
        // Priority 1: Check manual mappings from UI
        let productId: string | null = null;
        let finalProductName = productName;
        let mappingSource = "none";
        
        const manualMapping = manualMappings[planTitleLower];
        
        if (manualMapping?.customName) {
          // Priority 1: User provided custom name - we'll create/find product with this name
          finalProductName = manualMapping.customName;
          mappingSource = "manual_custom";
          console.log(`Using manual custom name: "${finalProductName}" for "${planTitle}"`);
        } else if (manualMapping?.productId) {
          // Priority 2: User selected existing product
          productId = manualMapping.productId;
          mappingSource = "manual_existing";
          const product = productsMap.get(productId);
          if (product) {
            finalProductName = product.name;
          }
          console.log(`Using manual product selection: ${productId} for "${planTitle}"`);
        } else {
          // Priority 3: Check existing database mappings
          const dbMapping = mappingsMap.get(planTitleLower);
          if (dbMapping?.product_id) {
            productId = dbMapping.product_id;
            mappingSource = "db_mapping";
            const product = productsMap.get(productId);
            if (product) {
              finalProductName = product.name;
            }
            console.log(`Using DB mapping: ${productId} for "${planTitle}"`);
          }
        }

        // Skip if onlyMapped is true and no mapping exists
        if (onlyMapped && mappingSource === "none") {
          console.log(`Skipping unmapped: ${planTitle}`);
          stats.skipped++;
          continue;
        }

        // Priority 4: Auto-create product with asterisk prefix
        if (!productId && mappingSource !== "manual_custom") {
          // Check if we already auto-created this product in this batch
          const cachedProductId = autoCreatedProducts.get(planTitleLower);
          if (cachedProductId) {
            productId = cachedProductId;
            mappingSource = "auto_cached";
          } else if (!dryRun) {
            // Create new product with asterisk prefix
            const autoProductName = `* ${productName}`;
            const autoProductCode = `archive-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
            
            const { data: newProduct, error: productError } = await supabase
              .from("products_v2")
              .insert({
                name: autoProductName,
                code: autoProductCode,
                type: "course",
                status: "archived",
                description: `Автоматически создан при импорте архива bePaid. Оригинальное название: ${productName}`,
              })
              .select()
              .single();

            if (productError) {
              console.error(`Error creating auto product: ${productError.message}`);
              // Continue without product - order will still be created
            } else if (newProduct) {
              productId = newProduct.id;
              autoCreatedProducts.set(planTitleLower, newProduct.id);
              stats.productsAutoCreated++;
              finalProductName = autoProductName;
              mappingSource = "auto_created";
              console.log(`Auto-created product: "${autoProductName}" (${newProduct.id})`);
              
              // Add to productsMap for future reference
              productsMap.set(newProduct.id, newProduct);
            }
          } else {
            // Dry run - just count
            stats.productsAutoCreated++;
            mappingSource = "auto_would_create";
          }
        }

        // Handle manual custom name - find or create product
        if (mappingSource === "manual_custom" && !dryRun) {
          // Look for existing product with this name
          const existingByName = (existingProducts || []).find(
            p => p.name.toLowerCase() === finalProductName.toLowerCase()
          );
          
          if (existingByName) {
            productId = existingByName.id;
            console.log(`Found existing product by custom name: ${productId}`);
          } else {
            // Create new product with the custom name
            const customProductCode = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
            
            const { data: newProduct, error: productError } = await supabase
              .from("products_v2")
              .insert({
                name: finalProductName,
                code: customProductCode,
                type: "course",
                status: "active",
                description: `Создан при импорте архива bePaid. Оригинальное название из bePaid: ${productName}`,
              })
              .select()
              .single();

            if (productError) {
              console.error(`Error creating custom product: ${productError.message}`);
            } else {
              productId = newProduct.id;
              console.log(`Created custom product: "${finalProductName}" (${productId})`);
            }
          }
        }

        // Check if it's a refund
        const isRefund = item.transaction_type?.toLowerCase().includes("возврат") ||
                        (item.amount && item.amount < 0);

        // Find or create profile
        let profile: any = null;
        let matchType = "none";

        // Try match by email
        if (item.customer_email) {
          profile = profilesByEmail.get(item.customer_email.toLowerCase());
          if (profile) matchType = "email";
        }

        // Try match by phone
        if (!profile && item.customer_phone) {
          const phone = item.customer_phone.replace(/\D/g, '');
          profile = profilesByPhone.get(phone);
          if (profile) matchType = "phone";
        }

        // Try match by card mask
        if (!profile && item.card_last4) {
          profile = profilesByCardMask.get(item.card_last4);
          if (profile) matchType = "card";
        }

        // Try match by cardholder name (transliterated)
        if (!profile && item.card_holder) {
          const cyrillicName = transliterateToСyrillic(item.card_holder);
          const nameParts = cyrillicName.split(' ').filter(p => p.length > 2);
          if (nameParts.length >= 2) {
            profile = (profiles || []).find(p => {
              if (!p.full_name) return false;
              const profileName = p.full_name.toLowerCase();
              return nameParts.every(part => profileName.includes(part.toLowerCase()));
            });
            if (profile) matchType = "name_translit";
          }
        }

        if (dryRun) {
          // In dry run mode, just count
          if (profile) {
            stats.profilesMatched++;
          } else {
            stats.profilesCreated++;
          }
          if (isRefund) {
            stats.refundsProcessed++;
          } else {
            stats.ordersCreated++;
            stats.paymentsCreated++;
          }
          continue;
        }

        // Create shadow profile if not found
        if (!profile) {
          const fullName = [item.customer_name, item.customer_surname].filter(Boolean).join(' ') ||
                          item.card_holder || "Клиент bePaid";
          
          const { data: newProfile, error: profileError } = await supabase
            .from("profiles")
            .insert({
              user_id: null, // Shadow profile
              email: item.customer_email || null,
              full_name: fullName,
              phone: item.customer_phone || null,
              status: "archived",
              card_masks: item.card_last4 ? [item.card_last4] : [],
              card_holder_names: item.card_holder ? [item.card_holder] : [],
              was_club_member: true,
            })
            .select()
            .single();

          if (profileError) {
            console.error(`Error creating profile: ${profileError.message}`);
            stats.errors.push(`Profile error: ${profileError.message}`);
            continue;
          }

          profile = newProfile;
          stats.profilesCreated++;
          
          // Add to lookup maps
          if (profile.email) profilesByEmail.set(profile.email.toLowerCase(), profile);
          if (profile.phone) profilesByPhone.set(profile.phone.replace(/\D/g, ''), profile);
        } else {
          stats.profilesMatched++;
        }

        // Handle refunds separately
        if (isRefund) {
          const refundUid = item.bepaid_uid;
          
          // Create payment with negative amount
          const { error: refundError } = await supabase
            .from("payments_v2")
            .insert({
              user_id: profile.user_id || profile.id,
              profile_id: profile.id,
              amount: Math.abs(item.amount || 0) * -1,
              currency: item.currency || "BYN",
              status: "refunded",
              provider: "bepaid",
              provider_payment_id: refundUid,
              card_last4: item.card_last4,
              card_brand: item.card_brand,
              paid_at: item.paid_at,
              product_name_raw: description,
              provider_response: payload,
            });

          if (refundError) {
            console.error(`Refund error: ${refundError.message}`);
            stats.errors.push(`Refund error: ${refundError.message}`);
          } else {
            stats.refundsProcessed++;
          }

          // Update queue item
          await supabase
            .from("payment_reconcile_queue")
            .update({ 
              status: "completed",
              matched_profile_id: profile.id,
              last_error: null,
            })
            .eq("id", item.id);

          continue;
        }

        // Check if payment already exists
        const { data: existingPayment } = await supabase
          .from("payments_v2")
          .select("id")
          .eq("provider_payment_id", item.bepaid_uid)
          .maybeSingle();

        if (existingPayment) {
          console.log(`Payment already exists: ${item.bepaid_uid}`);
          await supabase
            .from("payment_reconcile_queue")
            .update({ status: "completed", matched_profile_id: profile.id })
            .eq("id", item.id);
          stats.skipped++;
          continue;
        }

        // Get amount
        const amount = item.amount || (plan.amount ? plan.amount / 100 : 0);
        const actualPaymentDate = item.paid_at || item.created_at;

        // Generate order number
        const orderNumber = `ARC-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        // Create order
        const { data: order, error: orderError } = await supabase
          .from("orders_v2")
          .insert({
            order_number: orderNumber,
            user_id: profile.user_id || profile.id,
            profile_id: profile.id,
            product_id: productId,
            status: "paid",
            final_price: amount,
            base_price: amount,
            currency: item.currency || "BYN",
            customer_email: item.customer_email || profile.email,
            reconcile_source: "bepaid_archive_import",
            created_at: actualPaymentDate,
            purchase_snapshot: {
              product_name: finalProductName,
              original_bepaid_name: productName,
              imported_from: "bepaid_archive",
              bepaid_uid: item.bepaid_uid,
              deal_id: dealId,
              original_description: description,
              mapping_source: mappingSource,
            },
            meta: {
              customer_name: item.customer_name,
              customer_surname: item.customer_surname,
              card_holder: item.card_holder,
              card_last4: item.card_last4,
              imported_at: new Date().toISOString(),
              match_type: matchType,
            },
          })
          .select()
          .single();

        if (orderError) {
          console.error(`Order error: ${orderError.message}`);
          stats.errors.push(`Order error: ${orderError.message}`);
          continue;
        }

        stats.ordersCreated++;

        // Create payment
        const { error: paymentError } = await supabase
          .from("payments_v2")
          .insert({
            order_id: order.id,
            user_id: profile.user_id || profile.id,
            profile_id: profile.id,
            amount: amount,
            currency: item.currency || "BYN",
            status: "succeeded",
            provider: "bepaid",
            provider_payment_id: item.bepaid_uid,
            card_last4: item.card_last4,
            card_brand: item.card_brand,
            paid_at: actualPaymentDate,
            receipt_url: item.receipt_url,
            product_name_raw: description,
            provider_response: payload,
          });

        if (paymentError) {
          console.error(`Payment error: ${paymentError.message}`);
          stats.errors.push(`Payment error: ${paymentError.message}`);
        } else {
          stats.paymentsCreated++;
        }

        // Update queue item
        await supabase
          .from("payment_reconcile_queue")
          .update({ 
            status: "completed",
            matched_profile_id: profile.id,
            last_error: null,
          })
          .eq("id", item.id);

      } catch (itemError: any) {
        console.error(`Error processing item ${item.id}: ${itemError.message}`);
        stats.errors.push(`Item ${item.id}: ${itemError.message}`);
        
        await supabase
          .from("payment_reconcile_queue")
          .update({ 
            status: "error",
            last_error: itemError.message,
          })
          .eq("id", item.id);
      }
    }

    console.log("Import completed:", stats);

    return new Response(
      JSON.stringify({ 
        success: true, 
        stats,
        message: dryRun 
          ? `Dry run: would process ${stats.processed} items, auto-create ${stats.productsAutoCreated} products` 
          : `Processed ${stats.processed} items, auto-created ${stats.productsAutoCreated} products`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
