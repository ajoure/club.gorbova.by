import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

import { sendPaymentLinkToTelegram } from "@/lib/sendPaymentLinkToTelegram";

describe("sendPaymentLinkToTelegram", () => {
  beforeEach(() => invoke.mockReset());

  it("does not invoke Edge without a canonical deal owner", async () => {
    await expect(sendPaymentLinkToTelegram({
      userId: "  ",
      paymentUrl: "https://gorbova.by/pay/test",
      message: "Оплата",
    })).rejects.toThrow("нет владельца");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the normalized owner, message and payment button", async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });

    await sendPaymentLinkToTelegram({
      userId: "  user-1  ",
      paymentUrl: "https://gorbova.by/pay/token",
      message: "  Оплата остатка  ",
    });

    expect(invoke).toHaveBeenCalledWith("telegram-send-notification", {
      body: expect.objectContaining({
        user_id: "user-1",
        message_type: "custom",
        custom_message: "Оплата остатка",
        idempotency_key: expect.stringMatching(/^payment-link:[a-f0-9]{64}$/),
        reply_markup: {
          inline_keyboard: [[{
            text: "💳 Ссылка на оплату",
            url: "https://gorbova.by/pay/token",
          }]],
        },
      }),
    });
  });

  it("uses the same URL fingerprint for repeated delivery attempts", async () => {
    invoke.mockResolvedValue({ data: { success: true, skipped: true }, error: null });

    const input = {
      userId: "user-1",
      paymentUrl: "https://gorbova.by/pay/same-token",
      message: "Оплата",
    };
    await sendPaymentLinkToTelegram(input);
    await sendPaymentLinkToTelegram(input);

    const firstKey = invoke.mock.calls[0][1].body.idempotency_key;
    const secondKey = invoke.mock.calls[1][1].body.idempotency_key;
    expect(firstKey).toBe(secondKey);
  });

  it("exposes the Edge response reason and HTTP status", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };
    invoke.mockResolvedValue({ data: null, error });

    await expect(sendPaymentLinkToTelegram({
      userId: "user-1",
      paymentUrl: "https://gorbova.by/pay/token",
      message: "Оплата",
    })).rejects.toThrow("Недостаточно прав для этого действия. Обратитесь к администратору ролей. (HTTP 403)");
  });
});
