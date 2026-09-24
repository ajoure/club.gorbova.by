import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contactSheet = readFileSync(
  "src/components/admin/ContactDetailSheet.tsx",
  "utf8",
);
const grantFunction = readFileSync(
  "supabase/functions/telegram-grant-access/index.ts",
  "utf8",
);

describe("entitlement Telegram link resend contract", () => {
  it("exposes the action only through entitlement management and keeps the source lineage", () => {
    expect(contactSheet).toContain('hasPermission("entitlements.manage")');
    expect(contactSheet).toContain('source: "admin_entitlement_source_resend"');
    expect(contactSheet).toContain("entitlement_source_id: source.id");
    expect(contactSheet).toContain("force_resend: true");
    expect(contactSheet).toContain("Срок доступа не изменится");
  });

  it("validates the active source, user and club on the server", () => {
    expect(grantFunction).toContain("ENTITLEMENT_SOURCE_NOT_ACTIVE");
    expect(grantFunction).toContain("ENTITLEMENT_SOURCE_CLUB_MISMATCH");
    expect(grantFunction).toContain("String(entitlementSource.user_id) !== String(user_id)");
    expect(grantFunction).toContain("boundedValidUntil = entitlementSource.expires_at || null");
  });

  it("requires an explicit audited admin resend and never creates commercial rows", () => {
    expect(grantFunction).toContain("force_resend requires one club and an entitlement source");
    expect(grantFunction).toContain("admin.telegram.force_resend.requested");
    expect(grantFunction).toContain("actor_user_id: auditActorUserId");
    expect(grantFunction).not.toContain("actor_type: 'admin'\n        actor_id:");
    expect(grantFunction).toContain("if (!skipGrant && force_resend !== true)");
    expect(grantFunction).toContain("is_manual && force_resend !== true && admin_id");
    expect(grantFunction).not.toContain("admin_entitlement_source_resend').from('orders_v2')");
  });

  it("preserves the entitlement end date and exposes the real function error", () => {
    expect(grantFunction).toContain("valid_until: boundedValidUntil");
    expect(contactSheet).toContain("await normalizeEdgeFunctionErrorAsync(error)");
  });

  it("does not reference delivery locals in the Telegram-not-linked queue branch", () => {
    const queueBranch = grantFunction.slice(
      grantFunction.indexOf("if (!profile.telegram_user_id)"),
      grantFunction.indexOf("PATCH TG-REVOKE-FALSE-REGRANT"),
    );
    expect(queueBranch).not.toContain("dmSent");
    expect(queueBranch).not.toContain("result?.ok");
    expect(queueBranch).toContain("TG_NOT_LINKED_QUEUED");
  });

  it("gives each explicit resend a mirror key tied to the Telegram message", () => {
    expect(grantFunction).toContain("access_granted_dm:resend:");
    expect(grantFunction).toContain("result.result.message_id");
    expect(grantFunction).toContain("resend: force_resend === true");
  });

  it("reports delivery and Contact Center mirroring independently", () => {
    expect(grantFunction).toContain("mirror.ok && mirror.inserted");
    expect(grantFunction).toContain("dm_error: dmError || null");
    expect(grantFunction).toContain("mirrored_to_telegram_messages: wasMirroredToMessages");
    expect(grantFunction).toContain("success: deliverySucceeded");
    expect(grantFunction).toContain("partial: deliverySucceeded && !mirrorSucceeded");
  });

  it("shows success only for confirmed delivery plus a visible Contact Center mirror", () => {
    expect(contactSheet).toContain("failedResult?.dm_error");
    expect(contactSheet).toContain("data?.partial || unmirroredResult");
    expect(contactSheet).toContain("if (data?.queued)");
    expect(contactSheet).toContain("Ссылки поставлены в очередь");
    expect(contactSheet).toContain("отправлены клиенту и отображены в переписке");
    expect(contactSheet).toContain('["telegram-messages", targetUserId]');
    expect(contactSheet).toContain('["telegram-messages-lean", targetUserId]');
  });
});
