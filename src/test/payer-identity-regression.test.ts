/**
 * Regression: PDF payer identity MUST honor explicit legal_details_id.
 *
 * Bug fixed: document-data-snapshot rebuilt _provenance.customer_legal_details_id
 * from a profile-default cohort, ignoring order.meta.legal_details_id chosen in
 * the UI. This silently swapped the payer in the generated PDF to another
 * company (e.g. ЗАО «АЖУР инкам» вместо Azure Inc.).
 *
 * Guard: at the source level both snapshot builder and strict PDF generator
 * must (a) read order.meta.legal_details_id first, (b) validate ownership by
 * profile_id, (c) never fall back to a different profile's default when the
 * explicit id is present but does not belong to the order's profile.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("payer identity — explicit legal_details_id contract", () => {
  it("snapshot builder reads order.meta.legal_details_id before cohort", () => {
    const src = read("supabase/functions/_shared/document-data-snapshot.ts");
    expect(src).toMatch(/order\.meta[^)]*legal_details_id/);
    expect(src).toMatch(/explicit_order_meta_legal_details_id/);
    // Ownership guard is present.
    expect(src).toMatch(/explicit\.profile_id === order\.profile_id/);
    // Explicit-mismatch audit tag exists so the mismatch surfaces instead of a
    // silent fallback to another profile's default row.
    expect(src).toMatch(/snapshot_payer_explicit_mismatch/);
  });

  it("strict PDF generator prefers order.meta.legal_details_id and guards ownership", () => {
    const src = read("supabase/functions/canonical-document-generate-strict/index.ts");
    expect(src).toMatch(/order\.meta[^)]*legal_details_id/);
    expect(src).toMatch(/ld\.profile_id === order\.profile_id/);
  });

  it("invoice-checkout-issue persists chosen legal_details_id into order.meta", () => {
    const src = read("supabase/functions/invoice-checkout-issue/index.ts");
    expect(src).toMatch(/legal_details_id:\s*ld\.id/);
  });

  it("admin-invoice-checkout-issue validates legal_details ownership by target profile", () => {
    const src = read("supabase/functions/admin-invoice-checkout-issue/index.ts");
    expect(src).toMatch(/legal_details_profile_mismatch/);
    expect(src).toMatch(/legal_details_id:\s*ld\?\.id/);
  });
});

describe("payer identity — resolution logic (simulated)", () => {
  type LD = { id: string; profile_id: string; client_type: string; is_default?: boolean; leg_name?: string };
  const azure: LD = { id: "azure", profile_id: "P1", client_type: "legal_entity", is_default: false, leg_name: "Azure Inc." };
  const testCo: LD = { id: "testco", profile_id: "P1", client_type: "legal_entity", is_default: true, leg_name: "ООО «Тестовая компания»" };
  const third: LD = { id: "third", profile_id: "P1", client_type: "legal_entity", is_default: false, leg_name: "Third LLC" };
  const otherProfile: LD = { id: "other", profile_id: "P2", client_type: "legal_entity", is_default: true, leg_name: "Ажур инкам" };

  /** Mirrors document-data-snapshot resolution: explicit id first, ownership check, then cohort. */
  function resolve(order: { profile_id: string; meta: { legal_details_id?: string } }, all: LD[]): LD | null {
    const explicitId = order.meta.legal_details_id;
    if (explicitId) {
      const explicit = all.find((r) => r.id === explicitId) || null;
      if (explicit && explicit.profile_id === order.profile_id) return explicit;
      // Explicit id present but invalid/foreign → controlled null, do NOT fallback.
      return null;
    }
    const cohort = all
      .filter((r) => r.profile_id === order.profile_id && r.client_type === "legal_entity")
      .sort((a, b) => Number(b.is_default) - Number(a.is_default));
    return cohort[0] || null;
  }

  const all = [azure, testCo, third, otherProfile];

  it("picks Azure Inc. when second profile is selected", () => {
    expect(resolve({ profile_id: "P1", meta: { legal_details_id: "azure" } }, all)?.leg_name).toBe("Azure Inc.");
  });

  it("picks third profile when third is selected", () => {
    expect(resolve({ profile_id: "P1", meta: { legal_details_id: "third" } }, all)?.leg_name).toBe("Third LLC");
  });

  it("returns null (controlled error) when explicit id belongs to another profile", () => {
    expect(resolve({ profile_id: "P1", meta: { legal_details_id: "other" } }, all)).toBeNull();
  });

  it("returns null when explicit id is unknown — never silently swaps to default", () => {
    expect(resolve({ profile_id: "P1", meta: { legal_details_id: "nonexistent" } }, all)).toBeNull();
  });

  it("falls back to default cohort only when no explicit id is passed", () => {
    expect(resolve({ profile_id: "P1", meta: {} }, all)?.leg_name).toBe("ООО «Тестовая компания»");
  });
});
