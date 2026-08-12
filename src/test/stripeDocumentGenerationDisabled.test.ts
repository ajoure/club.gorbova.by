import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Stripe document generation suspension", () => {
  it("blocks Stripe generation server-side even for admin_force", () => {
    const source = read("supabase/functions/canonical-document-generate-strict/index.ts");

    expect(source).toContain("stripe_document_generation_disabled");
    expect(source).toContain("document.generate_blocked_stripe");
    expect(source).toContain("mode === 'generate' && succeededStripePayment");
  });

  it("removes the create action from Stripe deal cards", () => {
    const source = read("src/components/admin/DealPayerDocumentsCard.tsx");

    expect(source).toContain('const isStripePayment = String(payment?.provider || "").toLowerCase() === "stripe"');
    expect(source).toContain("Создание актов по платежам Stripe временно отключено.");
    expect(source).toContain("{isStripePayment ? (");
  });
});
