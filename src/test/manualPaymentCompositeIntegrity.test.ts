import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDealCommercialAmount } from "@/lib/payments/composableDealAmount";

describe("manual payment retry integrity", () => {
  it("uses the shared signing-key-safe caller authentication", () => {
    for (const file of [
      "supabase/functions/admin-create-manual-payment/index.ts",
      "supabase/functions/admin-retry-manual-payment-downstream/index.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain('../_shared/caller-user.ts');
      expect(source).not.toContain("auth.getClaims");
    }
  });

  it("uses an existing payment and cannot call the payment writer", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "supabase/functions/admin-retry-manual-payment-downstream/index.ts",
      ),
      "utf8",
    );
    expect(source).toContain('.from("payments_v2")');
    expect(source).toContain("payment_written: false");
    expect(source).not.toContain("admin_create_manual_payment_v1");
    expect(source).not.toMatch(/\.from\(["']payments_v2["']\)\s*\.insert/);
  });

  it("uses the least-privilege manual-payment edit contract for creation and retry", () => {
    for (const file of [
      "supabase/functions/admin-create-manual-payment/index.ts",
      "supabase/functions/admin-retry-manual-payment-downstream/index.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain('"has_admin_resource_access"');
      expect(source).toContain('_section_code: "payments"');
      expect(source).toContain('_resource_code: "manual-payment"');
      expect(source).toContain('_min_level: "edit"');
      expect(source).not.toContain('"has_admin_section_access"');
    }
  });

  it("shows the manual payment action only with payments edit access", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/admin/payments/PaymentsTabContent.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('canAccessResource(');
    expect(source).toContain('"manual-payment"');
    expect(source).toContain("canCreateManualPayment &&");
  });

  it("keeps the manual payment resource in the canonical menu registry", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/adminMenuRegistry.ts"),
      "utf8",
    );
    expect(source).toContain('code: "manual-payment"');
    expect(source).toContain('route: "/admin/payments?action=manual-payment"');
  });

  it("guards a fully paid order against a new manual payment key", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260729180632_manual_payment_fully_paid_guard.sql",
      ),
      "utf8",
    );
    expect(source).toContain("order_already_fully_paid");
    expect(source).toContain("FOR UPDATE");
    expect(source).toContain("v_idempotency_key");
  });
});

describe("composable deal amounts", () => {
  it("shows immutable line allocations instead of counting the basket twice", () => {
    const rows = [
      { final_price: 3300, composable_line_amount: 2650 },
      { final_price: 400, composable_line_amount: 400 },
      { final_price: 250, composable_line_amount: 250 },
    ];
    expect(rows.map(getDealCommercialAmount)).toEqual([2650, 400, 250]);
    expect(rows.reduce((sum, row) => sum + getDealCommercialAmount(row), 0)).toBe(
      3300,
    );
  });
});
