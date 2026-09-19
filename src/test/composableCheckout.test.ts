import { describe, expect, it, vi } from "vitest";
import {
  allocateComposablePayableTotal,
  buildComposableQuote,
} from "../../supabase/functions/_shared/composable-checkout";
import {
  deliverablePaidAddonProductIds,
  resolveComposableCheckout,
} from "../../supabase/functions/_shared/resolve-composable-checkout";

const primary = {
  role: "primary" as const,
  product_id: "p1",
  product_name: "Ценный бухгалтер",
  tariff_id: "t1",
  tariff_name: "Премиум",
  offer_id: "o1",
  list_amount: 1500,
};

const parentOffer = {
  id: "parent-offer",
  amount: 2990,
  is_active: true,
  tariff: {
    id: "parent-tariff",
    name: "Бизнес-леди",
    product: { id: "cb21", name: "Ценный бухгалтер", currency: "BYN", is_active: true },
  },
};

const addonRule = {
  id: "addon-rule",
  addon_product_id: "paid-product",
  addon_tariff_id: "paid-tariff",
  addon_offer_id: "paid-offer",
  pricing_mode: "percent_discount",
  fixed_amount: null,
  discount_percent: 50,
  is_required: false,
  is_default_selected: false,
  allow_repurchase_after_expiry: true,
  access_delivery_mode: "fixed_date",
  access_opens_at: "2026-12-09T21:00:00Z",
  access_duration_days: null,
  sort_order: 1,
  visible_from: null,
  visible_to: null,
  addon_product: { id: "paid-product", name: "Отраслевой модуль", category: "module", currency: "BYN", is_active: true },
  addon_tariff: { id: "paid-tariff", name: "Модуль", is_active: true },
  addon_offer: { id: "paid-offer", amount: 500, is_active: true },
};

function queryResult(result: unknown) {
  const promise = Promise.resolve(result);
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    order: () => query,
    maybeSingle: () => promise,
    then: promise.then.bind(promise),
  };
  return query;
}

function checkoutDb(config: {
  modules: unknown[];
  rules: unknown[];
  addons?: unknown[];
}) {
  return {
    from: vi.fn((table: string) => queryResult(
      table === "tariff_offers"
          ? { data: parentOffer, error: null }
        : table === "offer_addons"
          ? { data: config.addons ?? [addonRule], error: null }
          : table === "training_modules"
            ? { data: config.modules, error: null }
            : table === "access_rules"
              ? { data: config.rules, error: null }
              : { data: null, error: new Error(`unexpected table: ${table}`) },
    )),
  };
}

describe("composable checkout quote", () => {
  it("combines discounted and free modules with a manager adjustment", () => {
    const quote = buildComposableQuote([
      primary,
      { ...primary, role: "addon", product_id: "p2", offer_id: "o2", list_amount: 500, pricing_mode: "percent_discount", discount_percent: 20 },
      { ...primary, role: "addon", product_id: "p3", offer_id: "o3", list_amount: 500, pricing_mode: "free" },
    ], -100);
    expect(quote.subtotal).toBe(1900);
    expect(quote.total).toBe(1800);
    expect(quote.items.map((item) => item.final_amount)).toEqual([1500, 400, 0]);
  });

  it("rejects the same offer twice", () => {
    expect(() => buildComposableQuote([primary, { ...primary, role: "addon" }])).toThrow("duplicate_offer");
  });

  it("supports a fixed module price above list without a negative discount", () => {
    const quote = buildComposableQuote([
      primary,
      {
        ...primary,
        role: "addon",
        product_id: "p2",
        offer_id: "o2",
        list_amount: 400,
        pricing_mode: "fixed_price",
        fixed_amount: 500,
      },
    ]);
    expect(quote.items[1]).toMatchObject({
      list_amount: 400,
      final_amount: 500,
      discount_amount: 0,
    });
    expect(quote.total).toBe(2000);
  });

  it("rejects invalid percentage discounts and totals below zero", () => {
    expect(() => buildComposableQuote([
      primary,
      { ...primary, role: "addon", offer_id: "o2", pricing_mode: "percent_discount", discount_percent: 120 },
    ])).toThrow("invalid_final_amount");
    expect(() => buildComposableQuote([primary], -1500.01)).toThrow("invalid_adjustment");
  });

  it("allocates an order-level discount across all paid items to the exact cent", () => {
    const quote = buildComposableQuote([
      primary,
      { ...primary, role: "addon", product_id: "p2", offer_id: "o2", list_amount: 500 },
      { ...primary, role: "addon", product_id: "p3", offer_id: "o3", list_amount: 250 },
    ]);
    const allocated = allocateComposablePayableTotal(
      quote,
      1000.01,
      "referral_discount_or_customer_credit",
    );

    expect(allocated.items.reduce((sum, item) => sum + item.final_amount, 0)).toBeCloseTo(1000.01, 2);
    expect(allocated.total).toBe(1000.01);
    expect(allocated.adjustment_amount).toBe(-1249.99);
    expect((allocated as any).original_quote.total).toBe(2250);
  });

  it("uses deterministic largest-remainder rounding for a one-cent payment", () => {
    const tinyPrimary = { ...primary, list_amount: 1 };
    const quote = buildComposableQuote([
      tinyPrimary,
      { ...tinyPrimary, role: "addon", product_id: "p2", offer_id: "o2" },
      { ...tinyPrimary, role: "addon", product_id: "p3", offer_id: "o3" },
    ]);
    const allocated = allocateComposablePayableTotal(quote, 0.01, "credit");

    expect(allocated.items.map((item) => item.final_amount)).toEqual([0.01, 0, 0]);
    expect(() => allocateComposablePayableTotal(quote, 0, "credit")).toThrow("invalid_payable_total");
  });

  it("BizLady CB: primary 2650 stays full, addons discounted 50%", () => {
    const bizLadyPrimary = {
      role: "primary" as const,
      product_id: "cb-20",
      product_name: "Ценный бухгалтер",
      tariff_id: "biz-lady",
      tariff_name: "Бизнес-леди",
      offer_id: "biz-lady-100",
      list_amount: 2650,
    };
    const addon = (offer_id: string, name: string, list: number) => ({
      ...bizLadyPrimary,
      role: "addon" as const,
      product_id: offer_id,
      product_name: name,
      offer_id,
      list_amount: list,
      pricing_mode: "percent_discount" as const,
      discount_percent: 50,
    });
    const quote = buildComposableQuote([
      bizLadyPrimary,
      addon("mod-ip", "Учет у ИП", 800),
      addon("mod-mp", "Маркетплейсы", 600),
    ]);
    expect(quote.items[0].final_amount).toBe(2650);
    expect(quote.items[1].final_amount).toBe(400);
    expect(quote.items[2].final_amount).toBe(300);
    expect(quote.subtotal).toBe(3350);
    expect(quote.total).toBe(3350);
  });

  it("only treats a paid add-on as deliverable through its own full product rule", () => {
    const deliverable = deliverablePaidAddonProductIds(
      [
        { id: "root-ready", product_id: "paid-ready" },
        { id: "root-partial", product_id: "paid-partial" },
      ],
      [
        { product_id: "paid-ready", target_ref: "root-ready", grant_target_type: "training_content" as const, conditions: { access_mode: "full" } },
        { product_id: "paid-partial", target_ref: "root-partial", grant_target_type: "training_content" as const, conditions: { access_mode: "partial" } },
        { product_id: "course", target_ref: "root-ready", grant_target_type: "training_content" as const, conditions: { access_mode: "full" } },
        { product_id: "paid-missing-root", target_ref: "unknown", grant_target_type: "training_content" as const, conditions: { access_mode: "full" } },
        { product_id: "paid-ready", target_ref: "paid-ready", grant_target_type: "product_access" as const, conditions: { access_mode: "full" } },
        { product_id: "paid-ready", target_ref: "course", grant_target_type: "product_access" as const, conditions: { access_mode: "full" } },
      ],
    );

    expect([...deliverable]).toEqual(["paid-ready"]);
  });

  it("creates a composite quote only for a paid module with its own delivery rule", async () => {
    const result = await resolveComposableCheckout(checkoutDb({
      modules: [{ id: "module-root", product_id: "paid-product" }],
      rules: [{ product_id: "paid-product", target_ref: "module-root", grant_target_type: "training_content", conditions: { access_mode: "full" } }],
    }), {
      parentOfferId: "parent-offer",
      addonOfferIds: ["paid-offer"],
    });

    expect(result.total).toBe(3240);
    expect(result.selected_addon_offer_ids).toEqual(["paid-offer"]);
    expect(result.available_addons).toHaveLength(1);
  });

  it("accepts a product-access rule for the paid module's own training", async () => {
    const result = await resolveComposableCheckout(checkoutDb({
      modules: [{ id: "module-root", product_id: "paid-product" }],
      rules: [{ product_id: "paid-product", target_ref: "paid-product", grant_target_type: "product_access", conditions: { access_mode: "full" } }],
    }), {
      parentOfferId: "parent-offer",
      addonOfferIds: ["paid-offer"],
    });

    expect(result.selected_addon_offer_ids).toEqual(["paid-offer"]);
    expect(result.available_addons).toHaveLength(1);
  });

  it("fails closed when an otherwise purchasable paid module has no delivery setup", async () => {
    await expect(resolveComposableCheckout(checkoutDb({ modules: [], rules: [] }), {
      parentOfferId: "parent-offer",
      addonOfferIds: ["paid-offer"],
    })).rejects.toMatchObject({
      code: "addon_delivery_unconfigured",
      status: 409,
    });
  });

  it("does not apply a training-content gate to an ordinary additional service", async () => {
    const serviceAddon = {
      ...addonRule,
      addon_product_id: "service-product",
      addon_offer_id: "service-offer",
      addon_product: { ...addonRule.addon_product, id: "service-product", category: "service" },
      addon_offer: { ...addonRule.addon_offer, id: "service-offer" },
    };

    const result = await resolveComposableCheckout(checkoutDb({
      modules: [],
      rules: [],
      addons: [serviceAddon],
    }), {
      parentOfferId: "parent-offer",
      addonOfferIds: ["service-offer"],
    });

    expect(result.selected_addon_offer_ids).toEqual(["service-offer"]);
  });
});
