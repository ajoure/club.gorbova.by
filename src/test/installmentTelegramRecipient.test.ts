import { describe, expect, it } from "vitest";
import { resolveInstallmentTelegramRecipientUserId } from "@/lib/installmentTelegramRecipient";

describe("resolveInstallmentTelegramRecipientUserId", () => {
  it("prefers the current contact identity over a different legacy deal owner", () => {
    expect(
      resolveInstallmentTelegramRecipientUserId(" current-contact ", "legacy-deal-owner"),
    ).toBe("current-contact");
  });

  it("uses the original deal owner only outside a resolved contact card", () => {
    expect(resolveInstallmentTelegramRecipientUserId(null, " deal-owner ")).toBe("deal-owner");
  });

  it("fails closed when neither identity exists", () => {
    expect(resolveInstallmentTelegramRecipientUserId("  ", null)).toBeNull();
  });
});
