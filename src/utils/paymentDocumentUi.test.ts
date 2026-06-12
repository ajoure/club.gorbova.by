// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C — frontend tests.
// 0 network. 0 DB. 0 provider API. 0 generation.

import { describe, it, expect } from "vitest";
import {
  isSafeHttpsUrl,
  maskUuid,
  localizeMachineCode,
  providerDocTypeLabel,
  resolveCapabilities,
  sourceLabel,
  statusLabel,
} from "@/utils/paymentDocumentUi";
import { isResolverResponse } from "@/types/paymentDocuments";

describe("isSafeHttpsUrl", () => {
  it("accepts https URLs", () => {
    expect(isSafeHttpsUrl("https://pay.stripe.com/x")).toBe(true);
  });
  it("rejects http", () => {
    expect(isSafeHttpsUrl("http://x")).toBe(false);
  });
  it("rejects javascript: URLs", () => {
    expect(isSafeHttpsUrl("javascript:alert(1)")).toBe(false);
  });
  it("rejects data: URLs", () => {
    expect(isSafeHttpsUrl("data:text/html,<script>")).toBe(false);
  });
  it("rejects null/empty", () => {
    expect(isSafeHttpsUrl(null)).toBe(false);
    expect(isSafeHttpsUrl("")).toBe(false);
    expect(isSafeHttpsUrl(undefined)).toBe(false);
  });
  it("rejects malformed", () => {
    expect(isSafeHttpsUrl("not a url")).toBe(false);
  });
});

describe("maskUuid", () => {
  it("masks long uuids", () => {
    expect(maskUuid("12345678-aaaa-bbbb-cccc-1234567890ab"))
      .toMatch(/^123456…/);
  });
  it("returns dash for empty", () => {
    expect(maskUuid(null)).toBe("—");
  });
});

describe("localizeMachineCode", () => {
  it("localizes generation codes", () => {
    expect(localizeMachineCode("NO_DOCUMENT_SCENARIO")).toContain("сценария");
    expect(localizeMachineCode("MISSING_REQUIRED_REQUISITES")).toContain("реквизит");
    expect(localizeMachineCode("REFUND_USES_PARENT_DOCUMENTS")).toContain("исходному");
  });
  it("localizes stripe resolution codes", () => {
    expect(localizeMachineCode("STRIPE_MODE_MISMATCH")).toContain("Stripe");
    expect(localizeMachineCode("STRIPE_ACCOUNT_NOT_RESOLVED")).toContain("Stripe");
  });
  it("falls back safely on unknown", () => {
    expect(localizeMachineCode("WAT_UNKNOWN_CODE_42")).toBe(
      "Действие с документом сейчас недоступно",
    );
  });
  it("falls back safely on null", () => {
    expect(localizeMachineCode(null)).toBe(
      "Действие с документом сейчас недоступно",
    );
  });
});

describe("labels", () => {
  it("labels provider doc types", () => {
    expect(providerDocTypeLabel("receipt")).toBe("Чек");
    expect(providerDocTypeLabel("hosted_invoice")).toBe("Инвойс (страница)");
    expect(providerDocTypeLabel("invoice_pdf")).toBe("Инвойс (PDF)");
  });
  it("labels sources", () => {
    expect(sourceLabel("local_meta")).toBe("Локальные данные");
    expect(sourceLabel("parent_payment")).toBe("Исходный платёж");
  });
  it("labels statuses", () => {
    expect(statusLabel("available")).toBe("Доступен");
    expect(statusLabel("pending")).toBe("Формируется");
  });
});

describe("resolveCapabilities — combines backend caps + secondary HTTPS guard", () => {
  const base = { url: "https://x.example/y", can_open: true, can_download: true, can_copy: true };

  it("respects all caps when URL safe", () => {
    expect(resolveCapabilities(base)).toEqual({
      canOpen: true, canDownload: true, canCopy: true,
    });
  });
  it("blocks all actions for javascript: URL", () => {
    expect(resolveCapabilities({ ...base, url: "javascript:alert(1)" })).toEqual({
      canOpen: false, canDownload: false, canCopy: false,
    });
  });
  it("blocks all actions for null URL", () => {
    expect(resolveCapabilities({ ...base, url: null })).toEqual({
      canOpen: false, canDownload: false, canCopy: false,
    });
  });
  it("can_download=false hides Download even if URL is safe", () => {
    expect(resolveCapabilities({ ...base, can_download: false }).canDownload).toBe(false);
  });
  it("can_copy=false hides Copy even if URL is safe", () => {
    expect(resolveCapabilities({ ...base, can_copy: false }).canCopy).toBe(false);
  });
});

// ── Contract fixture ────────────────────────────────────────────────────────
// Mirrors the canonical resolver DTO from the backend proof. If the backend
// shape drifts, this test fails and forces a contract update.

const canonicalFixture = {
  payment: {
    id: "11111111-2222-3333-4444-555555555555",
    provider: "stripe",
    status: "succeeded",
    amount: 100,
    currency: "EUR",
    order_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    is_refund: false,
  },
  provider_documents: [
    {
      provider: "stripe",
      type: "receipt",
      external_id: "ch_test",
      status: "available",
      source: "local_meta",
      url: "https://pay.stripe.com/receipts/abc",
      url_kind: "external_provider",
      can_open: true,
      can_download: false,
      can_copy: true,
      expires_at: null,
    },
  ],
  internal_documents: [
    {
      id: "ddddeeee-1111-2222-3333-444455556666",
      order_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      document_type: "invoice_act",
      status: "generated",
      number: "СА-000001",
      created_at: "2026-06-12T10:00:00.000Z",
      url: "https://signed.example/x",
      url_kind: "signed_storage",
      can_open: true,
      can_download: true,
      can_copy: false,
      expires_at: "2026-06-12T11:00:00.000Z",
    },
  ],
  generation: { scenario_found: false, can_generate: false, blocked_reason: "NO_DOCUMENT_SCENARIO" },
  diagnostics: null,
  warnings: [],
};

describe("isResolverResponse — runtime DTO guard", () => {
  it("accepts canonical fixture", () => {
    expect(isResolverResponse(canonicalFixture)).toBe(true);
  });
  it("rejects null/string/number", () => {
    expect(isResolverResponse(null)).toBe(false);
    expect(isResolverResponse("x")).toBe(false);
    expect(isResolverResponse(42)).toBe(false);
  });
  it("rejects malformed payment", () => {
    const bad = { ...canonicalFixture, payment: { ...canonicalFixture.payment, id: 42 } };
    expect(isResolverResponse(bad)).toBe(false);
  });
  it("rejects provider_documents that is not an array", () => {
    const bad = { ...canonicalFixture, provider_documents: "no" };
    expect(isResolverResponse(bad)).toBe(false);
  });
  it("rejects malformed warning", () => {
    const bad = { ...canonicalFixture, warnings: [{ code: 42 }] };
    expect(isResolverResponse(bad)).toBe(false);
  });
  it("accepts diagnostics object when present", () => {
    const ok = { ...canonicalFixture, diagnostics: { stripe: { mode: "test" } } };
    expect(isResolverResponse(ok)).toBe(true);
  });
});
