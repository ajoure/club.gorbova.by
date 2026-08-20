import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get lookup params from query
    const url = new URL(req.url);
    let domain = url.searchParams.get("domain");
    const productId = url.searchParams.get("product_id");
    const productCode = url.searchParams.get("product_code");
    const userId = url.searchParams.get("user_id");

    // Count how many lookup keys were provided
    const lookupKeys = [productId, productCode, domain].filter(Boolean);

    // Auto-detect domain from host header only if no explicit params
    if (lookupKeys.length === 0) {
      const host = req.headers.get("host") || req.headers.get("x-forwarded-host");
      if (host) {
        domain = host.split(":")[0];
        lookupKeys.push(domain);
      }
    }

    // Conflict guard: if multiple lookup keys provided, verify they resolve to the same product
    if (lookupKeys.length > 1) {
      // We'll resolve by priority and verify consistency below
      console.log(`[public-product] Multiple lookup keys provided: product_id=${productId}, product_code=${productCode}, domain=${domain}`);
    }

    if (lookupKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: "Domain, product_id, or product_code not specified" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[public-product] Lookup: product_id=${productId || 'none'}, product_code=${productCode || 'none'}, domain=${domain || 'none'}, user_id=${userId || 'none'}`);

    // Determine resolved_by and build query
    let resolvedBy: 'product_id' | 'product_code' | 'domain';
    let resolvedValue: string;

    const productFields = `
      id, name, code, slug, status, primary_domain, currency,
      public_title, public_subtitle, payment_disclaimer_text,
      landing_config, telegram_club_id, is_active
    `;

    let productQuery = supabase
      .from("products_v2")
      .select(productFields)
      .eq("status", "active")
      .eq("is_active", true);

    // Priority: product_id > product_code > domain
    if (productId) {
      productQuery = productQuery.eq("id", productId);
      resolvedBy = 'product_id';
      resolvedValue = productId;
    } else if (productCode) {
      productQuery = productQuery.eq("code", productCode);
      resolvedBy = 'product_code';
      resolvedValue = productCode;
    } else {
      productQuery = productQuery.eq("primary_domain", domain!);
      resolvedBy = 'domain';
      resolvedValue = domain!;
    }

    const { data: product, error: productError } = await productQuery.single();

    if (productError || !product) {
      console.log(`[public-product] Product not found. resolved_by=${resolvedBy}, value=${resolvedValue}`);
      return new Response(
        JSON.stringify({ error: "Product not found", resolved_by: resolvedBy, resolved_value: resolvedValue }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Conflict guard: if multiple keys were provided, verify they all match the resolved product
    if (lookupKeys.length > 1) {
      const mismatches: string[] = [];
      if (productId && product.id !== productId) {
        mismatches.push(`product_id mismatch: expected ${productId}, got ${product.id}`);
      }
      if (productCode && product.code !== productCode) {
        mismatches.push(`product_code mismatch: expected ${productCode}, got ${product.code}`);
      }
      if (domain && product.primary_domain !== domain) {
        mismatches.push(`domain mismatch: expected ${domain}, got ${product.primary_domain}`);
      }
      if (mismatches.length > 0) {
        console.error(`[public-product] Conflict detected: ${mismatches.join('; ')}`);
        return new Response(
          JSON.stringify({ 
            error: "Conflicting lookup parameters resolve to different products",
            details: mismatches,
            resolved_by: resolvedBy,
            resolved_value: resolvedValue 
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // PATCH-FINAL: Check product-scoped reentry pricing
    let isReentryPricing = false;
    let reentryMessage = "";

    if (userId && product.id) {
      const { data: reentryRecord } = await supabase
        .from("product_reentry_pricing")
        .select("reentry_active")
        .eq("user_id", userId)
        .eq("product_id", product.id)
        .eq("reentry_active", true)
        .maybeSingle();

      if (reentryRecord) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("reentry_penalty_waived")
          .eq("user_id", userId)
          .maybeSingle();

        if (!profile?.reentry_penalty_waived) {
          isReentryPricing = true;
          reentryMessage = "Вы ранее были участником клуба. При повторном вступлении действуют новые условия.";
          console.log(`[public-product] User ${userId} has product-scoped reentry pricing for product ${product.id}`);
        }
      }
    }

    // Fetch active tariffs for this product
    const now = new Date().toISOString();
    const { data: tariffs, error: tariffsError } = await supabase
      .from("tariffs")
      .select(`
        id, code, name, description, badge, subtitle,
        price_monthly, period_label, access_days, features, is_popular,
        discount_enabled, discount_percent, original_price,
        trial_enabled, trial_days, trial_price, trial_auto_charge, sort_order, meta, is_public
      `)
      .eq("product_id", product.id)
      .eq("is_active", true)
      .eq("is_public", true)
      .or(`visible_from.is.null,visible_from.lte.${now}`)
      .or(`visible_to.is.null,visible_to.gte.${now}`)
      .order("sort_order", { ascending: true });

    if (tariffsError) {
      console.error("[public-product] Error fetching tariffs:", tariffsError);
    }

    // Fetch tariff features
    const tariffIds = tariffs?.map((t) => t.id) || [];
    let tariffFeatures: any[] = [];

    if (tariffIds.length > 0) {
      const { data: featuresData, error: featuresError } = await supabase
        .from("tariff_features")
        .select(`
          id, tariff_id, text, icon, is_bonus, is_highlighted,
          sort_order, visibility_mode, active_from, active_to, label, link_url
        `)
        .in("tariff_id", tariffIds)
        .order("sort_order", { ascending: true });

      if (featuresError) {
        console.error("[public-product] Error fetching features:", featuresError);
      } else {
        tariffFeatures = (featuresData || []).filter((f) => {
          if (f.visibility_mode === "always") return true;
          const now = new Date();
          if (f.visibility_mode === "until_date" && f.active_to) {
            return now <= new Date(f.active_to);
          }
          if (f.visibility_mode === "date_range") {
            const from = f.active_from ? new Date(f.active_from) : null;
            const to = f.active_to ? new Date(f.active_to) : null;
            if (from && now < from) return false;
            if (to && now > to) return false;
            return true;
          }
          return true;
        });
      }
    }

    // Fetch active offers
    let offers: any[] = [];

    if (tariffIds.length > 0) {
      const { data: offersData, error: offersError } = await supabase
        .from("tariff_offers")
        .select(`
          id, tariff_id, offer_type, button_label, amount, reentry_amount,
          trial_days, auto_charge_after_trial, auto_charge_amount, auto_charge_delay_days,
          requires_card_tokenization, is_primary, payment_method, installment_count,
          sort_order, meta
        `)
        .in("tariff_id", tariffIds)
        .eq("is_active", true)
        .or(`visible_from.is.null,visible_from.lte.${now}`)
        .or(`visible_to.is.null,visible_to.gte.${now}`)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (offersError) {
        console.error("[public-product] Error fetching offers:", offersError);
      } else {
        const nowDate = new Date();
        offers = (offersData || []).map(offer => {
          if (offer.offer_type === 'preregistration' && offer.meta?.preregistration) {
            const prereg = offer.meta.preregistration;
            const chargeDate = prereg.first_charge_date ? new Date(prereg.first_charge_date) : null;
            
            if (chargeDate && nowDate >= chargeDate && prereg.auto_convert_after_date) {
              const linkedOfferId = prereg.charge_offer_id;
              if (linkedOfferId) {
                const linkedOffer = offersData.find(o => o.id === linkedOfferId);
                if (linkedOffer) {
                  console.log(`[public-product] Auto-converting preregistration to pay_now: ${linkedOfferId}`);
                  return { ...linkedOffer, replaced_preregistration: true };
                }
              }
              return null;
            }
          }
          return offer;
        }).filter(Boolean);
      }
    }

    // Only offers with an explicitly configured, currently available addon
    // should open the composable checkout. Ordinary payment/trial/invoice
    // buttons must go straight to their configured flow.
    const offerIds = offers.map((offer) => offer.id);
    const offersWithAvailableAddons = new Set<string>();
    if (offerIds.length > 0) {
      const { data: addonRules, error: addonRulesError } = await supabase
        .from("offer_addons")
        .select(`
          parent_offer_id, visible_from, visible_to,
          addon_product:products_v2!offer_addons_addon_product_id_fkey(is_active),
          addon_tariff:tariffs!offer_addons_addon_tariff_id_fkey(is_active),
          addon_offer:tariff_offers!offer_addons_addon_offer_id_fkey(is_active)
        `)
        .in("parent_offer_id", offerIds)
        .eq("is_active", true);

      if (addonRulesError) {
        console.error("[public-product] Error fetching offer addons:", addonRulesError);
      } else {
        const nowMs = Date.now();
        for (const rule of addonRules || []) {
          const isAvailable =
            (!rule.visible_from || Date.parse(rule.visible_from) <= nowMs) &&
            (!rule.visible_to || Date.parse(rule.visible_to) >= nowMs) &&
            (rule.addon_product as any)?.is_active === true &&
            (rule.addon_tariff as any)?.is_active === true &&
            (rule.addon_offer as any)?.is_active === true;
          if (isAvailable) offersWithAvailableAddons.add(rule.parent_offer_id);
        }
      }
    }

    // Map features and offers to tariffs (apply reentry pricing)
    const tariffsWithOffers = tariffs?.map((tariff) => ({
      ...tariff,
      features: tariffFeatures.filter((f) => f.tariff_id === tariff.id),
      offers: offers
        .filter((o) => o.tariff_id === tariff.id)
        .sort((a, b) => {
          const aSort = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 0;
          const bSort = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
          return aSort - bSort || String(a.id).localeCompare(String(b.id));
        })
        .map((offer) => {
          const withCompositionFlag = {
            ...offer,
            has_available_addons: offersWithAvailableAddons.has(offer.id),
          };
          if (isReentryPricing && offer.reentry_amount) {
            return {
              ...withCompositionFlag,
              original_amount: offer.amount,
              amount: offer.reentry_amount,
              is_reentry_price: true,
            };
          }
          return { ...withCompositionFlag, is_reentry_price: false };
        }),
    })) || [];

    // Fetch current pricing stage
    const { data: currentStage } = await supabase
      .from("pricing_stages")
      .select("id, name, stage_type")
      .eq("product_id", product.id)
      .eq("is_active", true)
      .lte("start_date", now)
      .or(`end_date.is.null,end_date.gte.${now}`)
      .order("display_order", { ascending: true })
      .limit(1)
      .single();

    // If we have a pricing stage, fetch prices
    let tariffPrices: any[] = [];
    if (currentStage && tariffIds.length > 0) {
      const { data: pricesData } = await supabase
        .from("tariff_prices")
        .select(`tariff_id, price, final_price, discount_enabled, discount_percent, currency`)
        .in("tariff_id", tariffIds)
        .eq("pricing_stage_id", currentStage.id)
        .eq("is_active", true);

      tariffPrices = pricesData || [];
    }

    // Merge prices into tariffs
    const tariffsWithPrices = tariffsWithOffers.map((tariff) => {
      const stagePrice = tariffPrices.find((p) => p.tariff_id === tariff.id);
      const currentPrice = stagePrice?.final_price || stagePrice?.price || tariff.price_monthly;
      const hasReentryOffer = tariff.offers.some((o: any) => o.is_reentry_price);
      
      return {
        ...tariff,
        current_price: currentPrice,
        base_price: stagePrice?.price || tariff.price_monthly,
        discount_percent: stagePrice?.discount_enabled ? stagePrice.discount_percent : null,
        has_reentry_pricing: hasReentryOffer,
      };
    });

    console.log(`[public-product] Returning product ${product.name} (resolved_by=${resolvedBy}) with ${tariffsWithPrices.length} tariffs, reentry: ${isReentryPricing}`);

    return new Response(
      JSON.stringify({
        product: {
          id: product.id,
          name: product.name,
          code: product.code,
          slug: product.slug,
          currency: product.currency,
          public_title: product.public_title,
          public_subtitle: product.public_subtitle,
          payment_disclaimer_text: product.payment_disclaimer_text,
          landing_config: product.landing_config || {
            tariffs_title: "Тарифы",
            tariffs_subtitle: "Выберите подходящий формат участия",
            show_badges: true,
            price_suffix: "BYN",
          },
          telegram_club_id: product.telegram_club_id,
        },
        tariffs: tariffsWithPrices,
        pricing_stage: currentStage || null,
        is_reentry_pricing: isReentryPricing,
        reentry_message: reentryMessage,
        _meta: {
          resolved_by: resolvedBy,
          resolved_value: resolvedValue,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[public-product] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
