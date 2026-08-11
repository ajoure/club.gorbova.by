import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adjustRefundAccessActionForAmount,
  DEFAULT_REFUND_ACCESS_ACTION,
} from "@/lib/refundAccessPolicy";

const refundDialog = readFileSync(
  resolve(process.cwd(), "src/components/admin/RefundDialog.tsx"),
  "utf8",
);
const subscriptionAdminActions = readFileSync(
  resolve(process.cwd(), "supabase/functions/subscription-admin-actions/index.ts"),
  "utf8",
);
const telegramRevokeAccess = readFileSync(
  resolve(process.cwd(), "supabase/functions/telegram-revoke-access/index.ts"),
  "utf8",
);

describe("refund access preservation", () => {
  it("defaults money refunds to preserving access", () => {
    expect(DEFAULT_REFUND_ACCESS_ACTION).toBe("keep");
  });

  it("does not overwrite keep on a full refund", () => {
    expect(adjustRefundAccessActionForAmount("keep", true)).toBe("keep");
    expect(adjustRefundAccessActionForAmount("keep_subscription", true)).toBe("keep_subscription");
  });

  it("does not allow a partial refund to revoke all access", () => {
    expect(adjustRefundAccessActionForAmount("revoke", false)).toBe("reduce");
  });

  it("shows preserve access for full refunds and sends the chosen action", () => {
    expect(refundDialog).toContain("Сохранить доступ");
    expect(refundDialog).not.toContain("(!isFullRefund || !!selectedGroupItemId)");
    expect(refundDialog).toContain("access_action: accessAction");
  });

  it("uses a safe backend default and preserves another Telegram right", () => {
    expect(subscriptionAdminActions).toContain("const effectiveAccessAction = access_action || 'keep'");
    expect(subscriptionAdminActions).not.toContain("access_action: access_action || 'revoke'");
    expect(subscriptionAdminActions).toContain("respect_remaining_access: true");
    expect(telegramRevokeAccess).toContain("!isAdminAction || respectRemainingAccess");
  });
});
