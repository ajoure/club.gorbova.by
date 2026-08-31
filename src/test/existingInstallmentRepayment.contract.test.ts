import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("existing installment repayment integration boundary", () => {
  it("routes marked public links before the generic new-sale checkout", () => {
    const source = read("supabase/functions/public-checkout/index.ts");
    const repayment = source.indexOf("createExistingInstallmentCheckout");
    const generic = source.indexOf("createPaymentCheckout({");
    expect(repayment).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(repayment);
  });

  it("routes repayment webhooks before ordinary subscription and link-order flows", () => {
    const source = read("supabase/functions/bepaid-webhook/index.ts");
    const repayment = source.indexOf("handleExistingInstallmentRepaymentWebhook({");
    const genericSubscription = source.indexOf("rawTrackingId?.startsWith('subv2:')");
    const genericLink = source.indexOf("isOneTimeLinkOrderWebhook");
    expect(repayment).toBeGreaterThan(-1);
    expect(genericSubscription).toBeGreaterThan(repayment);
    expect(genericLink).toBeGreaterThan(repayment);
  });

  it("keeps repayment materialization on the original order without an access writer", () => {
    const source = read("supabase/functions/_shared/existing-installment-webhook.ts");
    expect(source).toContain("order_id: orderId");
    expect(source).toContain("changes_access: false");
    expect(source).not.toContain("grant-access-for-order");
    expect(source).not.toContain(".from('entitlements')");
    expect(source).not.toContain(".insert({\n        order_number");
  });

  it("records a successful provider payment before replacing the old mandate", () => {
    const source = read("supabase/functions/_shared/existing-installment-webhook.ts");
    const paymentWrite = source.indexOf("const paymentResult = await upsertPayment");
    const cancel = source.indexOf("Replaced by customer-approved installment repayment link");
    expect(paymentWrite).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(paymentWrite);
    expect(source).toContain("payment_recorded: true");
  });

  it("never interprets a successful refund as a repayment and keeps canonical finance origin", () => {
    const source = read("supabase/functions/_shared/existing-installment-webhook.ts");
    const refundGuard = source.indexOf("if (isRefund)");
    const successWrite = source.indexOf("const paymentResult = await upsertPayment");
    expect(refundGuard).toBeGreaterThan(-1);
    expect(successWrite).toBeGreaterThan(refundGuard);
    expect(source).toContain("repayment_refund_requires_reconciliation");
    expect(source).toContain("origin: 'bepaid'");
    expect(source).not.toContain("origin: 'installment_repayment'");
  });

  it("can recover a stale provider checkout without allowing a concurrent duplicate", () => {
    const source = read("supabase/functions/_shared/existing-installment-checkout.ts");
    expect(source).toContain("['draft', 'failed', 'ready', 'creating']");
    expect(source).toContain("checkout_attempt_id', expectedClaim.attemptId");
    expect(source).toContain("repayment_checkout_in_progress");
  });

  it("exposes the action from the contact installment card", () => {
    const card = read("src/components/installments/ContactInternalInstallments.tsx");
    const dialog = read("src/components/installments/ExistingInstallmentRepaymentDialog.tsx");
    expect(card).toContain("ExistingInstallmentRepaymentDialog");
    expect(dialog).toContain("Создать ссылку на остаток");
    expect(dialog).toContain("Новый продукт, сделка и дополнительный доступ не создаются");
  });
});
