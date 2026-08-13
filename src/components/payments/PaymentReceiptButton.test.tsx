import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentReceiptButton } from "./PaymentReceiptButton";
import { resolvePaymentReceiptUrl } from "@/lib/payments/paymentReceiptResolver";

vi.mock("@/lib/payments/paymentReceiptResolver", () => ({
  resolvePaymentReceiptUrl: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

describe("PaymentReceiptButton", () => {
  const replace = vi.fn();
  const close = vi.fn();
  const popup = {
    closed: false,
    opener: null,
    location: { replace },
    close,
  } as unknown as Window;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockReturnValue(popup);
  });

  it("opens a blank popup synchronously and replaces it with the fresh receipt URL", async () => {
    vi.mocked(resolvePaymentReceiptUrl).mockResolvedValue("https://pay.stripe.com/receipts/payment/fresh");
    render(<PaymentReceiptButton paymentId="payment-id" />);

    fireEvent.click(screen.getByRole("button", { name: /открыть чек/i }));
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("https://pay.stripe.com/receipts/payment/fresh");
    });
  });

  it("closes the blank popup when the receipt cannot be refreshed", async () => {
    vi.mocked(resolvePaymentReceiptUrl).mockRejectedValue(new Error("provider unavailable"));
    render(<PaymentReceiptButton paymentId="payment-id" />);

    fireEvent.click(screen.getByRole("button", { name: /открыть чек/i }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });
});
