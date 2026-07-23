import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { buildComposableQuote, type QuoteSourceItem } from "../_shared/composable-checkout.ts";

interface RequestBody {
  parent_offer_id?: string;
  addon_offer_ids?: string[];
  adjustment_amount?: number;
  adjustment_reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = await req.json() as RequestBody;
  if (!body.parent_offer_id) return errorResponse("parent_offer_id_required", 400);

  let actorId: string | null = null;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const { data } = await admin.auth.getUser(authHeader.slice(7));
    actorId = data.user?.id ?? null;
  }
  const roleChecks = actorId
    ? await Promise.all(["manager", "menedzher", "admin", "super_admin"].map(async (role) =>
        (await admin.rpc("has_role_v2", { _user_id: actorId, _role_code: role })).data === true
      ))
    : [];
  const isStaff = roleChecks.some(Boolean);
  const adjustment = Number(body.adjustment_amount ?? 0);
  if (adjustment !== 0 && !isStaff) return errorResponse("staff_adjustment_forbidden", 403);
  if (adjustment !== 0 && !String(body.adjustment_reason ?? "").trim()) {
    return errorResponse("adjustment_reason_required", 400);
  }

  const { data: parentOffer } = await admin
    .from("tariff_offers")
    .select("id, amount, is_active, tariff:tariffs!tariff_offers_tariff_id_fkey(id,name,product:products_v2!tariffs_product_id_fkey(id,name,currency))")
    .eq("id", body.parent_offer_id)
    .maybeSingle();
  if (!parentOffer?.is_active) return errorResponse("parent_offer_unavailable", 404);

  const { data: addonRules, error: addonError } = await admin
    .from("offer_addons")
    .select("id,addon_product_id,addon_tariff_id,addon_offer_id,pricing_mode,fixed_amount,discount_percent,is_required,is_default_selected,sort_order,visible_from,visible_to,addon_product:products_v2!offer_addons_addon_product_id_fkey(id,name,currency),addon_tariff:tariffs!offer_addons_addon_tariff_id_fkey(id,name),addon_offer:tariff_offers!offer_addons_addon_offer_id_fkey(id,amount,is_active)")
    .eq("parent_offer_id", body.parent_offer_id)
    .eq("is_active", true)
    .order("sort_order");
  if (addonError) return errorResponse("addon_configuration_unavailable", 500);

  const now = Date.now();
  const available = (addonRules ?? []).filter((rule: any) =>
    (!rule.visible_from || Date.parse(rule.visible_from) <= now) &&
    (!rule.visible_to || Date.parse(rule.visible_to) >= now) &&
    rule.addon_offer?.is_active === true
  );
  const requested = new Set(body.addon_offer_ids ?? []);
  for (const id of requested) {
    if (!available.some((rule: any) => rule.addon_offer_id === id)) {
      return errorResponse("addon_not_allowed", 400);
    }
  }
  const selected = available.filter((rule: any) => rule.is_required || requested.has(rule.addon_offer_id));
  const parentTariff: any = parentOffer.tariff;
  const currency = parentTariff?.product?.currency ?? "BYN";
  if (selected.some((rule: any) => (rule.addon_product?.currency ?? currency) !== currency)) {
    return errorResponse("mixed_currency_not_supported", 400);
  }

  const source: QuoteSourceItem[] = [{
    role: "primary",
    product_id: parentTariff.product.id,
    product_name: parentTariff.product.name,
    tariff_id: parentTariff.id,
    tariff_name: parentTariff.name,
    offer_id: parentOffer.id,
    list_amount: Number(parentOffer.amount),
    sort_order: 0,
  }, ...selected.map((rule: any) => ({
    role: "addon" as const,
    product_id: rule.addon_product_id,
    product_name: rule.addon_product.name,
    tariff_id: rule.addon_tariff_id,
    tariff_name: rule.addon_tariff.name,
    offer_id: rule.addon_offer_id,
    list_amount: Number(rule.addon_offer.amount),
    pricing_mode: rule.pricing_mode,
    fixed_amount: rule.fixed_amount == null ? null : Number(rule.fixed_amount),
    discount_percent: rule.discount_percent == null ? null : Number(rule.discount_percent),
    sort_order: rule.sort_order,
  }))];

  try {
    const quote = buildComposableQuote(source, adjustment);
    return jsonResponse({
      success: true,
      currency,
      ...quote,
      adjustment_reason: adjustment === 0 ? null : String(body.adjustment_reason).trim(),
      available_addons: available.map((rule: any) => ({
        addon_product_id: rule.addon_product_id,
        addon_product_name: rule.addon_product.name,
        addon_tariff_id: rule.addon_tariff_id,
        addon_tariff_name: rule.addon_tariff.name,
        addon_offer_id: rule.addon_offer_id,
        list_amount: Number(rule.addon_offer.amount),
        pricing_mode: rule.pricing_mode,
        fixed_amount: rule.fixed_amount,
        discount_percent: rule.discount_percent,
        is_required: rule.is_required,
        is_default_selected: rule.is_default_selected,
      })),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "quote_failed", 400);
  }
});
