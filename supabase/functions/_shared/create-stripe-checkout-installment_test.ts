import { assertEquals } from "jsr:@std/assert@1";
import { createStripeCheckout } from "./create-stripe-checkout.ts";
import { buildFiniteInstallmentOrderMeta } from "../public-checkout/installment-meta.ts";

Deno.test("canonical and legacy finite links stop before Stripe credentials, purchase writes or network", async () => {
  const forbidden = () => { throw new Error("unexpected checkout side effect"); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = forbidden;
  try {
    for (const meta_extra of [
      buildFiniteInstallmentOrderMeta({ selected_installment_months: 2, per_payment_amount_byn: 100 }),
      { installment: { as_finite_subscription: true } },
      { installment: { infinite: false } },
      { payment_method: "internal_installment" },
    ]) {
      const result = await createStripeCheckout({
        supabase: new Proxy({}, { get: forbidden }),
        user_id: "synthetic-user", product_id: "synthetic-consultation", tariff_id: "synthetic-tariff",
        amount: 100, currency: "BYN", payment_type: "subscription", meta_extra,
      });
      assertEquals(result, { success: false, provider: "stripe", error: "stripe_finite_installment_unsupported" });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
