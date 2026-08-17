import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokenInput = readFileSync(
  "src/components/admin/TokenizedRichInput.tsx",
  "utf8",
);
const worker = readFileSync(
  "supabase/functions/crm-pipeline-automation-worker/index.ts",
  "utf8",
);
const documentResolver = readFileSync(
  "supabase/functions/_shared/document-render.ts",
  "utf8",
);

describe("CRM automation canonical document tokens", () => {
  it("uses document_token_registry as the picker source, not a CRM alias catalogue", () => {
    expect(tokenInput).toContain("loadCanonicalTokenRefs");
    expect(tokenInput).toContain('queryKey: ["canonical-document-token-refs"]');
    expect(tokenInput).not.toContain("CRM_AUTOMATION_PLACEHOLDER_REFS");
    expect(tokenInput).not.toContain("CRM-DEAL-");
  });

  it("resolves canonical dotted keys through the same document resolver", () => {
    expect(worker).toContain('resolveCanonicalPayload(supabase');
    expect(worker).toContain('context_type: "order"');
    expect(worker).toContain("[^{}]+?");
    expect(worker).toContain('"customer.name": canonicalValues["customer.name"]');
    expect(documentResolver).toContain("Optional for a data-only consumer such as CRM automation");
    expect(documentResolver).toContain("template_required_for_generation");
    expect(documentResolver).toContain("'product.name':");
    expect(documentResolver).toContain("'deal.amount':");
    expect(documentResolver).toContain("'contact.full_name':");
  });
});
