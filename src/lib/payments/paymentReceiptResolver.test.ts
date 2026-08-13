import { describe, expect, it, vi } from "vitest";
import { isSafePaymentReceiptUrl, resolvePaymentReceiptUrl } from "./paymentReceiptResolver";

describe("paymentReceiptResolver", () => {
  it("accepts only approved provider HTTPS hosts", () => {
    expect(isSafePaymentReceiptUrl("https://pay.stripe.com/receipts/payment/fresh")).toBe(true);
    expect(isSafePaymentReceiptUrl("https://invoice.stripe.com/i/acct/test")).toBe(true);
    expect(isSafePaymentReceiptUrl("https://evil.example/receipt")).toBe(false);
    expect(isSafePaymentReceiptUrl("javascript:alert(1)")).toBe(false);
    expect(isSafePaymentReceiptUrl("https://pay.stripe.com.evil.example/x")).toBe(false);
  });

  it("returns the freshly resolved URL", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        payment_id: "payment-id",
        provider: "stripe",
        url: "https://pay.stripe.com/receipts/payment/fresh",
        document_type: "receipt",
        can_download: false,
      },
      error: null,
    });
    await expect(resolvePaymentReceiptUrl("payment-id", invoke)).resolves.toBe(
      "https://pay.stripe.com/receipts/payment/fresh",
    );
  });

  it("rejects an unsafe URL even when a function returns it", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, url: "https://pay.stripe.com.evil.example/x" },
      error: null,
    });
    await expect(resolvePaymentReceiptUrl("payment-id", invoke)).rejects.toThrow("RECEIPT_RESOLVE_FAILED");
  });
});
