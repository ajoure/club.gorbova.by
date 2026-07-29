import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "supabase/functions/admin-invoice-checkout-issue/index.ts",
  "utf8",
);

describe("admin invoice automatic delivery regression", () => {
  it("starts canonical delivery after strict PDF generation", () => {
    const generateAt = source.indexOf(
      "/functions/v1/canonical-document-generate-strict",
    );
    const sendAt = source.indexOf("/functions/v1/canonical-document-send");

    expect(generateAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(generateAt);
    expect(source).toContain("if (documentId)");
    expect(source).toContain("send_email: true");
    expect(source).toContain("send_telegram: true");
  });

  it("keeps the background delivery alive and records its outcome", () => {
    expect(source).toContain("EdgeRuntime");
    expect(source).toContain("waitUntil(sendPromise)");
    expect(source).toContain(
      "admin_invoice_checkout.document_send_completed",
    );
    expect(source).toContain("admin_invoice_checkout.document_send_failed");
    expect(source).toContain("entity_type: \"ai_generated_document\"");
    expect(source).toContain("entity_id: documentId");
  });
});
