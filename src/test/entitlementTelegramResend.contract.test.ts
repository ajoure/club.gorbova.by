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
});
