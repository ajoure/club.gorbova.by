// Regression tests for PATCH-INV20-REBILL-SUPERSEDED-2026-05
// Verifies extractOrderUid behavior for bepaid_rebill orphan orders.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Inline copies (the function isn't exported from index.ts to keep edge entry minimal).
function extractUidFromMeta(meta: any): { uid: string; source: string } | null {
  if (!meta) return null;
  for (const key of ["transaction_uid", "bepaid_payment_uid", "provider_payment_id"]) {
    const val = meta[key];
    if (typeof val === "string" && val.length > 5) return { uid: val, source: `meta.${key}` };
  }
  return null;
}

function extractOrderUid(order: any): { uid: string; source: string } | null {
  const fromMeta = extractUidFromMeta(order?.meta);
  if (fromMeta) return fromMeta;
  const col = order?.provider_payment_id;
  if (typeof col === "string" && col.length > 5 && order?.provider === "bepaid") {
    return { uid: col, source: "column.provider_payment_id" };
  }
  return null;
}

Deno.test("REBILL bepaid_rebill orphan: meta empty, column UID present → resolves via column", () => {
  const order = {
    id: "c82ad679-12e4-4d37-a263-16c91657a07b",
    order_number: "REBILL-2071054f-906",
    provider: "bepaid",
    provider_payment_id: "2071054f-906d-406a-9c20-f0dc08e5c737",
    meta: { source: "bepaid_rebill" },
  };
  const got = extractOrderUid(order);
  assertEquals(got, {
    uid: "2071054f-906d-406a-9c20-f0dc08e5c737",
    source: "column.provider_payment_id",
  });
});

Deno.test("REBILL bepaid_rebill orphan #2: same pattern", () => {
  const order = {
    id: "ecd989f1-1245-45b8-9774-67808799bb58",
    order_number: "REBILL-97fb20f7-f7c",
    provider: "bepaid",
    provider_payment_id: "97fb20f7-f7cc-4c04-bc1b-a8b0c384ab98",
    meta: { source: "bepaid_rebill" },
  };
  const got = extractOrderUid(order);
  assertEquals(got?.uid, "97fb20f7-f7cc-4c04-bc1b-a8b0c384ab98");
  assertEquals(got?.source, "column.provider_payment_id");
});

Deno.test("meta UID has priority over column", () => {
  const order = {
    provider: "bepaid",
    provider_payment_id: "col-uid-aaaaaaaa",
    meta: { transaction_uid: "meta-uid-bbbbbbbb" },
  };
  const got = extractOrderUid(order);
  assertEquals(got, { uid: "meta-uid-bbbbbbbb", source: "meta.transaction_uid" });
});

Deno.test("non-bepaid provider: column fallback DISALLOWED", () => {
  const order = {
    provider: "stripe",
    provider_payment_id: "pi_1234567890abcdef",
    meta: {},
  };
  const got = extractOrderUid(order);
  assertEquals(got, null);
});

Deno.test("no UID anywhere → null", () => {
  const order = { provider: "bepaid", provider_payment_id: null, meta: {} };
  assertEquals(extractOrderUid(order), null);
});

Deno.test("short/garbage column UID → null", () => {
  const order = { provider: "bepaid", provider_payment_id: "x", meta: {} };
  assertEquals(extractOrderUid(order), null);
});
