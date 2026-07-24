import { describe, it, expect } from "vitest";
import {
  renderChannelUi,
  isDeliveryFinal,
  type DeliveryStatusResponse,
} from "@/lib/invoiceDelivery";

function base(): DeliveryStatusResponse {
  return {
    document_id: "doc-1",
    document_number: "0407/4",
    pdf_ready: true,
    delivery: {
      email: { status: "sent", at: null, error: null, recipient: "a@b.c" },
      telegram: { status: "sent", at: null, error: null, recipient: "123" },
    },
  };
}

describe("renderChannelUi", () => {
  it("shows retry only on error", () => {
    expect(renderChannelUi("email", { status: "error", at: null, error: "smtp", recipient: null }).canRetry).toBe(true);
    expect(renderChannelUi("email", { status: "sent", at: null, error: null, recipient: null }).canRetry).toBe(false);
    expect(renderChannelUi("email", { status: "queued", at: null, error: null, recipient: null }).canRetry).toBe(false);
  });

  it("does not offer retry for telegram not_linked", () => {
    const ui = renderChannelUi("telegram", { status: "not_linked", at: null, error: null, recipient: null });
    expect(ui.canRetry).toBe(false);
    expect(ui.label).toMatch(/не привязан/i);
    expect(ui.tone).toBe("muted");
  });

  it("does not offer retry for email no_recipient", () => {
    const ui = renderChannelUi("email", { status: "no_recipient", at: null, error: null, recipient: null });
    expect(ui.canRetry).toBe(false);
    expect(ui.tone).toBe("muted");
  });

  it("surfaces error detail", () => {
    const ui = renderChannelUi("email", { status: "error", at: null, error: "greylisted", recipient: null });
    expect(ui.errorDetail).toBe("greylisted");
  });
});

describe("isDeliveryFinal", () => {
  it("false while pdf is not ready", () => {
    const s = base();
    s.pdf_ready = false;
    expect(isDeliveryFinal(s)).toBe(false);
  });
  it("false while any channel is queued", () => {
    const s = base();
    s.delivery.email.status = "queued";
    expect(isDeliveryFinal(s)).toBe(false);
  });
  it("true when both channels are sent", () => {
    expect(isDeliveryFinal(base())).toBe(true);
  });
  it("true when one channel errored and another is not_linked", () => {
    const s = base();
    s.delivery.email = { status: "error", at: null, error: "x", recipient: null };
    s.delivery.telegram = { status: "not_linked", at: null, error: null, recipient: null };
    expect(isDeliveryFinal(s)).toBe(true);
  });
});
