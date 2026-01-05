import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get domain from query param or Host header
    const url = new URL(req.url);
    let domain = url.searchParams.get("domain");
    
    if (!domain) {
      const host = req.headers.get("host") || req.headers.get("x-forwarded-host");
      if (host) {
        domain = host.split(":")[0]; // Remove port if present
      }
    }

    console.log(`[public-product] Looking up product for domain: ${domain}`);

    if (!domain) {
      return new Response(
        JSON.stringify({ error: "Domain not specified" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch product by primary_domain with landing_config
    const { data: product, error: productError } = await supabase
      .from("products_v2")
      .select(`
        id,
        name,
        code,
        slug,
        status,
        primary_domain,
        currency,
        public_title,
        public_subtitle,
        payment_disclaimer_text,
        landing_config,
        telegram_club_id,
        is_active
      `)
      .eq("primary_domain", domain)
      .eq("status", "active")
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      console.log(`[public-product] Product not found for domain: ${domain}`);
      return new Response(
        JSON.stringify({ error: "Product not found", domain }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch active tariffs for this product with extended fields
    const now = new Date().toISOString();
    const { data: tariffs, error: tariffsError } = await supabase
      .from("tariffs")
      .select(`
        id,
        code,
        name,
        description,
        badge,
        subtitle,
        price_monthly,
        period_label,
        access_days,
        features,
        is_popular,
        discount_enabled,
        discount_percent,
        original_price,
        trial_enabled,
        trial_days,
        trial_price,
        trial_auto_charge,
        sort_order
      `)
      .eq("product_id", product.id)
      .eq("is_active", true)
      .or(`visible_from.is.null,visible_from.lte.${now}`)
      .or(`visible_to.is.null,visible_to.gte.${now}`)
      .order("sort_order", { ascending: true });

    if (tariffsError) {
      console.error("[public-product] Error fetching tariffs:", tariffsError);
    }

    // Fetch active offers for each tariff
    const tariffIds = tariffs?.map((t) => t.id) || [];
    let offers: any[] = [];

    if (tariffIds.length > 0) {
      const { data: offersData, error: offersError } = await supabase
        .from("tariff_offers")
        .select(`
          id,
          tariff_id,
          offer_type,
          button_label,
          amount,
          trial_days,
          auto_charge_after_trial,
          auto_charge_amount,
          auto_charge_delay_days,
          requires_card_tokenization,
          sort_order
        `)
        .in("tariff_id", tariffIds)
        .eq("is_active", true)
        .or(`visible_from.is.null,visible_from.lte.${now}`)
        .or(`visible_to.is.null,visible_to.gte.${now}`)
        .order("sort_order", { ascending: true });

      if (offersError) {
        console.error("[public-product] Error fetching offers:", offersError);
      } else {
        offers = offersData || [];
      }
    }

    // Map offers to tariffs
    const tariffsWithOffers = tariffs?.map((tariff) => ({
      ...tariff,
      offers: offers.filter((o) => o.tariff_id === tariff.id),
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
        .select(`
          tariff_id,
          price,
          final_price,
          discount_enabled,
          discount_percent,
          currency
        `)
        .in("tariff_id", tariffIds)
        .eq("pricing_stage_id", currentStage.id)
        .eq("is_active", true);

      tariffPrices = pricesData || [];
    }

    // Merge prices into tariffs
    const tariffsWithPrices = tariffsWithOffers.map((tariff) => {
      const stagePrice = tariffPrices.find((p) => p.tariff_id === tariff.id);
      return {
        ...tariff,
        current_price: stagePrice?.final_price || stagePrice?.price || tariff.price_monthly,
        base_price: stagePrice?.price || tariff.price_monthly,
        discount_percent: stagePrice?.discount_enabled ? stagePrice.discount_percent : null,
      };
    });

    console.log(`[public-product] Returning product ${product.name} with ${tariffsWithPrices.length} tariffs`);

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
            price_suffix: "BYN/мес",
          },
        },
        tariffs: tariffsWithPrices,
        pricing_stage: currentStage || null,
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
