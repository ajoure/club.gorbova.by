import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("contact payment-link RBAC and RR regression contract", () => {
  const dialog = read("src/components/admin/AdminPaymentLinkDialog.tsx");
  const siblingAddonMapper = read("src/utils/mapSiblingAddonOfferIds.ts");
  const contact = read("src/components/admin/ContactDetailSheet.tsx");
  const links = read("src/components/admin/payments/links/LinksTabContent.tsx");
  const auth = read("supabase/functions/_shared/admin-section-auth.ts");
  const direct = read("supabase/functions/admin-create-payment-link/index.ts");
  const publicLink = read("supabase/functions/admin-create-public-link/index.ts");
  const invoice = read("supabase/functions/admin-invoice-checkout-issue/index.ts");
  const quote = read("supabase/functions/composable-checkout-quote/index.ts");
  const telegram = read("supabase/functions/telegram-send-notification/index.ts");
  const rr = read("supabase/functions/public-rr-installment-initiate/index.ts");
  const registry = read("supabase/functions.registry.txt");

  it("uses payments:edit as the shared write boundary", () => {
    expect(auth).toContain('admin.auth.getUser(token)');
    expect(auth).toContain('admin.rpc("has_admin_section_access"');
    expect(auth).toContain('_section_code: sectionCode');
    expect(auth).toContain('_min_level: minLevel');
    expect(auth).toContain('return await requireAdminSectionAccess(req, admin, "payments", "edit")');

    for (const writer of [direct, publicLink, invoice, quote, rr]) {
      expect(writer).toContain("requirePaymentsEdit");
    }
    expect(direct).not.toContain("entitlements.manage");
    expect(invoice).not.toContain('["admin", "super_admin", "menedzher", "manager"]');
    expect(quote).not.toContain('["manager", "menedzher", "admin", "super_admin"]');
  });

  it("shows payment-link creation only with payments:edit", () => {
    expect(contact).toContain('canAccessSection("payments", "edit")');
    expect(contact).toContain('{canEditPayments && (');
    expect(links).toContain('canAccessSection("payments", "edit")');
    expect(links).toContain('{canEditPayments && (');
  });

  it("sends the RR contract expected by the Edge Function and reads its response", () => {
    expect(dialog).toContain("tariff_offer_id: rrSiblingOffer.id");
    expect(dialog).toContain("target_user_id: userId");
    expect(dialog).toContain("addon_offer_ids: siblingAddonMapping.addonOfferIds");
    expect(dialog).toContain("adjustment_amount: siblingComposableAdjustment");
    expect(dialog).toContain("adjustment_reason: siblingComposableAdjustment === 0 ? null : adjustmentReason.trim()");
    expect(dialog).toContain("mapSiblingAddonOfferIds(");
    expect(dialog).toContain("?.payment_url ??");
    expect(dialog).not.toMatch(/\n\s*offer_id:\s*rrSiblingOffer\.id/);
  });

  it("maps addon offer ids separately for invoice and RR sibling offers", () => {
    // One occurrence builds the validated sibling quote; the other two are the
    // invoice and RR writers that consume the same validated mapping.
    expect(dialog.match(/addon_offer_ids: siblingAddonMapping\.addonOfferIds/g)).toHaveLength(3);
    expect(dialog).toContain('"composable-checkout-sibling-catalog"');
    expect(dialog).toContain('"composable-checkout-sibling-quote"');
    expect(siblingAddonMapper).toContain("addon_product_id");
    expect(siblingAddonMapper).toContain("siblingByProductId");
  });

  it("binds admin RR orders to the target contact and keeps the actor in audit metadata", () => {
    expect(rr).toContain('const adminMode = hasTargetUserField || hasAdjustmentAmountField || hasAdjustmentReasonField');
    expect(rr).toContain('errorResponse("admin_fields_forbidden", 403)');
    expect(rr).toContain('.eq("user_id", targetUserId)');
    expect(rr).toContain("userId = targetUserId");
    expect(rr).toContain("_offer_id: offerId, _user_id: userId");
    expect(rr).toContain("admin_actor_id: adminActorId");
    expect(rr).toContain('action: "rr.admin_payment_link_initiated"');
    expect(rr).toContain("actor_user_id: adminActorId");
    expect(rr).toContain("target_user_id: userId");
  });

  it("applies an audited admin adjustment without exposing it to public callers", () => {
    expect(rr).toContain('return errorResponse("adjustment_reason_required", 400)');
    expect(rr).toContain("Number(composableQuote.subtotal) + requestedAdjustment");
    expect(rr).toContain('allocationReason = "admin_adjustment"');
    expect(rr).toContain("admin_adjustment_amount: requestedAdjustment");
    expect(direct).toContain("adjustment_reason_required");
    expect(direct).toContain("adjustment_amount: adjustmentAmount");
    expect(direct).toContain("adjustment_reason: adjustmentAmount === 0 ? null : adjustmentReason");
  });

  it("preserves communication access while allowing payment-link delivery", () => {
    expect(telegram).toContain("hasAdminSectionAccess(supabase, user.id, 'communication', 'edit')");
    expect(telegram).toContain("hasAdminSectionAccess(supabase, user.id, 'payments', 'edit')");
    expect(telegram).not.toContain("entitlements.manage");
  });

  it("registers both payment helper functions for managed deployment", () => {
    expect(registry).toMatch(/^composable-checkout-quote$/m);
    expect(registry).toMatch(/^public-rr-installment-initiate$/m);
  });
});
