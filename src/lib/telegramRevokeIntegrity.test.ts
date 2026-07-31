import { describe, expect, it } from "vitest";

import revokeSource from "../../supabase/functions/telegram-revoke-access/index.ts?raw";
import expirySource from "../../supabase/functions/telegram-check-expired/index.ts?raw";

describe("Telegram revoke integrity", () => {
  it("does not report a failed preventive ban as successful", () => {
    expect(revokeSource).toContain("preventiveBan.ok === true");
    expect(revokeSource).not.toContain("preventiveBan.ok || true");
  });

  it("retains access state when Telegram has not confirmed every configured ban", () => {
    expect(revokeSource).toContain("TELEGRAM_REVOKE_INCOMPLETE");
    expect(revokeSource).toContain("retaining access state for retry");
  });

  it("does not expire grants after an unconfirmed revoke response", () => {
    expect(expirySource).toContain("telegram.access_expired_revoke_failed");
    expect(expirySource).toContain("if (revokeFailure)");
    expect(expirySource).toContain("continue;");
  });
});
