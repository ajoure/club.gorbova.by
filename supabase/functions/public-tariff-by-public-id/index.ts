import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const tariffPublicId = url.searchParams.get("tariff_public_id");
    const userId = url.searchParams.get("user_id");

    if (!tariffPublicId) {
      return new Response(
        JSON.stringify({ error: "tariff_public_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[public-tariff-by-public-id] Looking up tariff: ${tariffPublicId}`);

    // Fetch tariff by public_id
    const { data: tariff, error: tariffError } = await supabase
      .from("tariffs")
      .select(`
        id, code, name, description, badge, subtitle, price_monthly,
        period_label, access_days, features, is_popular, public_id,
        discount_enabled, discount_percent, original_price,
        trial_enabled, trial_days, trial_price, trial_auto_charge,
        sort_order, product_id, is_active, is_public,
        visible_from, visible_to, meta
      `)
      .eq("public_id", tariffPublicId)
      .single();

    if (tariffError || !tariff) {
      return new Response(
        JSON.stringify({ error: "Tariff not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Internal/manual tariffs must not be recoverable through a guessed direct
    // public_id either. They remain available to authenticated admin tooling.
    if (!tariff.is_active || !tariff.is_public) {
      return new Response(
        JSON.stringify({ error: "Tariff is not publicly available" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    if (tariff.visible_from && now < new Date(tariff.visible_from)) {
      return new Response(
        JSON.stringify({ error: "Tariff not yet visible" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (tariff.visible_to && now > new Date(tariff.visible_to)) {
      return new Response(
        JSON.stringify({ error: "Tariff no longer visible" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch parent product
    const { data: product, error: productError } = await supabase
      .from("products_v2")
      .select(`
        id, name, code, slug, status, primary_domain, currency,
        public_title, public_subtitle, payment_disclaimer_text,
        landing_config, is_active, telegram_club_id
      `)
      .eq("id", tariff.product_id)
      .eq("is_active", true)
      .eq("status", "active")
      .single();

    if (productError || !product) {
      return new Response(
        JSON.stringify({ error: "Product not found or inactive" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PATCH-FINAL: Check product-scoped reentry pricing
    let isReentryPricing = false;
    let reentryMessage = "";
    if (userId && tariff.product_id) {
      const { data: reentryRecord } = await supabase
        .from("product_reentry_pricing")
        .select("reentry_active")
        .eq("user_id", userId)
        .eq("product_id", tariff.product_id)
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
        }
      }
    }

    // Fetch features
    const { data: featuresData } = await supabase
      .from("tariff_features")
      .select(`
        id, tariff_id, text, icon, is_bonus, is_highlighted, sort_order,
        visibility_mode, active_from, active_to, label, link_url
      `)
      .eq("tariff_id", tariff.id)
      .order("sort_order", { ascending: true });

    const features = (featuresData || []).filter((f: any) => {
      if (!f.visibility_mode || f.visibility_mode === "always") return true;
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

    // Fetch active offers
    const nowIso = now.toISOString();
    const { data: offersData } = await supabase
      .from("tariff_offers")
      .select(`
        id, tariff_id, offer_type, button_label, amount, reentry_amount,
        trial_days, auto_charge_after_trial, auto_charge_amount,
        auto_charge_delay_days, requires_card_tokenization, is_primary,
        payment_method, installment_count, sort_order, meta
      `)
      .eq("tariff_id", tariff.id)
      .eq("is_active", true)
      .or(`visible_from.is.null,visible_from.lte.${nowIso}`)
      .or(`visible_to.is.null,visible_to.gte.${nowIso}`)
      .order("sort_order", { ascending: true });

    let offers = (offersData || []).map((offer: any) => {
      if (isReentryPricing && offer.reentry_amount) {
        return { ...offer, original_amount: offer.amount, amount: offer.reentry_amount, is_reentry_price: true };
      }
      return { ...offer, is_reentry_price: false };
    });

    // Fetch current pricing stage
    const { data: currentStage } = await supabase
      .from("pricing_stages")
      .select("id, name, stage_type")
      .eq("product_id", product.id)
      .eq("is_active", true)
      .lte("start_date", nowIso)
      .or(`end_date.is.null,end_date.gte.${nowIso}`)
      .order("display_order", { ascending: true })
      .limit(1)
      .single();

    let currentPrice = tariff.price_monthly;
    let basePrice = tariff.price_monthly;
    let discountPercent = null;

    if (currentStage) {
      const { data: priceData } = await supabase
        .from("tariff_prices")
        .select("tariff_id, price, final_price, discount_enabled, discount_percent, currency")
        .eq("tariff_id", tariff.id)
        .eq("pricing_stage_id", currentStage.id)
        .eq("is_active", true)
        .single();

      if (priceData) {
        currentPrice = priceData.final_price || priceData.price || tariff.price_monthly;
        basePrice = priceData.price || tariff.price_monthly;
        discountPercent = priceData.discount_enabled ? priceData.discount_percent : null;
      }
    }

    const tariffResult = {
      ...tariff,
      features,
      offers,
      current_price: currentPrice,
      base_price: basePrice,
      discount_percent: discountPercent,
      has_reentry_pricing: offers.some((o: any) => o.is_reentry_price),
    };

    console.log(`[public-tariff-by-public-id] Returning tariff ${tariff.name} with ${features.length} features, ${offers.length} offers`);

    return new Response(
      JSON.stringify({
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          currency: product.currency,
          public_title: product.public_title,
          public_subtitle: product.public_subtitle,
          payment_disclaimer_text: product.payment_disclaimer_text,
          primary_domain: product.primary_domain || null,
          telegram_club_id: product.telegram_club_id || null,
          landing_config: product.landing_config || {
            tariffs_title: "Тариф",
            tariffs_subtitle: "",
            show_badges: true,
            price_suffix: "BYN",
          },
        },
        tariff: tariffResult,
        pricing_stage: currentStage || null,
        is_reentry_pricing: isReentryPricing,
        reentry_message: reentryMessage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[public-tariff-by-public-id] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
