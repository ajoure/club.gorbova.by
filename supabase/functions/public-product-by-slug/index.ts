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

    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    const userId = url.searchParams.get("user_id");

    console.log(`[public-product-by-slug] Looking up product for slug: ${slug}, user_id: ${userId || 'none'}`);

    if (!slug) {
      return new Response(
        JSON.stringify({ error: "Slug not specified" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PATCH-FINAL: Reentry pricing will be checked after product is resolved (product-scoped)
    let isReentryPricing = false;
    let reentryMessage = "";

    // Fetch product by slug OR public_id
    const { data: product, error: productError } = await supabase
      .from("products_v2")
      .select(`
        id, name, code, slug, status, primary_domain, currency,
        public_title, public_subtitle, payment_disclaimer_text,
        landing_config, telegram_club_id, is_active
      `)
      .or(`slug.eq.${slug},public_id.eq.${slug}`)
      .eq("status", "active")
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      console.log(`[public-product-by-slug] Product not found for slug: ${slug}`);
      return new Response(
        JSON.stringify({ error: "Product not found", slug }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PATCH-FINAL: Check product-scoped reentry pricing after product is resolved
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
          console.log(`[public-product-by-slug] User ${userId} has product-scoped reentry pricing for product ${product.id}`);
        }
      }
    }

    // Fetch active tariffs
    const now = new Date().toISOString();
    const { data: tariffs, error: tariffsError } = await supabase
      .from("tariffs")
      .select(`
        id, code, name, description, badge, subtitle, price_monthly,
        period_label, access_days, features, is_popular,
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
      console.error("[public-product-by-slug] Error fetching tariffs:", tariffsError);
    }

    const tariffIds = tariffs?.map((t) => t.id) || [];
    let tariffFeatures: any[] = [];

    if (tariffIds.length > 0) {
      const { data: featuresData, error: featuresError } = await supabase
        .from("tariff_features")
        .select(`
          id, tariff_id, text, icon, is_bonus, is_highlighted, sort_order,
          visibility_mode, active_from, active_to, label, link_url
        `)
        .in("tariff_id", tariffIds)
        .order("sort_order", { ascending: true });

      if (featuresError) {
        console.error("[public-product-by-slug] Error fetching features:", featuresError);
      } else {
        // Filter features by visibility
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
          trial_days, auto_charge_after_trial, auto_charge_amount,
          auto_charge_delay_days, requires_card_tokenization, is_primary,
          payment_method, installment_count, sort_order, meta
        `)
        .in("tariff_id", tariffIds)
        .eq("is_active", true)
        .or(`visible_from.is.null,visible_from.lte.${now}`)
        .or(`visible_to.is.null,visible_to.gte.${now}`)
        .order("sort_order", { ascending: true });

      if (offersError) {
        console.error("[public-product-by-slug] Error fetching offers:", offersError);
      } else {
        const nowDate = new Date();
        offers = (offersData || []).map(offer => {
          if (offer.offer_type === 'preregistration' && offer.meta?.preregistration) {
            const prereg = offer.meta.preregistration;
            const chargeDate = prereg.first_charge_date ? new Date(prereg.first_charge_date) : null;
            if (chargeDate && nowDate >= chargeDate && prereg.auto_convert_after_date) {
              const linkedOffer = offersData.find(o => o.id === prereg.charge_offer_id);
              if (linkedOffer) return { ...linkedOffer, replaced_preregistration: true };
              return null;
            }
          }
          return offer;
        }).filter(Boolean);
      }
    }

    // Map features and offers to tariffs
    const tariffsWithOffers = tariffs?.map((tariff) => ({
      ...tariff,
      features: tariffFeatures.filter((f) => f.tariff_id === tariff.id),
      offers: offers
        .filter((o) => o.tariff_id === tariff.id)
        .map((offer) => {
          if (isReentryPricing && offer.reentry_amount) {
            return { ...offer, original_amount: offer.amount, amount: offer.reentry_amount, is_reentry_price: true };
          }
          return { ...offer, is_reentry_price: false };
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

    console.log(`[public-product-by-slug] Returning product ${product.name} with ${tariffsWithPrices.length} tariffs`);

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
          primary_domain: product.primary_domain || null, // PATCH 8: include for banner
          landing_config: product.landing_config || {
            tariffs_title: "Тарифы",
            tariffs_subtitle: "Выберите подходящий формат участия",
            show_badges: true,
            price_suffix: "BYN",
          },
        },
        tariffs: tariffsWithPrices,
        pricing_stage: currentStage || null,
        is_reentry_pricing: isReentryPricing,
        reentry_message: reentryMessage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[public-product-by-slug] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
