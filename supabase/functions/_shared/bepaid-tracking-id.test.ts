// PATCH-VERONIKA-MATUK-GORBOVA-CLUB-REPAIR — parser parity tests
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseBepaidTrackingId } from "./bepaid-tracking-id.ts";

const SUB = "0396c3d9-a469-4124-b8c9-9b50228b66b6";
const ORDER = "7a7f4595-8b64-43fe-adaf-f543d423ebe4";
const OFFER = "bc0f7a90-df41-4a86-b2ea-2a1234d0d534";

Deno.test("subv2:{sub}:order:{order} → kind=subv2 with both ids", () => {
  const r = parseBepaidTrackingId(`subv2:${SUB}:order:${ORDER}`);
  assertEquals(r.kind, "subv2");
  assertEquals(r.subscriptionV2Id, SUB);
  assertEquals(r.orderId, ORDER);
});

Deno.test("legacy subv2:{sub} → kind=subv2 sub only", () => {
  const r = parseBepaidTrackingId(`subv2:${SUB}`);
  assertEquals(r.kind, "subv2");
  assertEquals(r.subscriptionV2Id, SUB);
  assertEquals(r.orderId, null);
});

Deno.test("link:order:{order} → kind=link_order", () => {
  const r = parseBepaidTrackingId(`link:order:${ORDER}`);
  assertEquals(r.kind, "link_order");
  assertEquals(r.orderId, ORDER);
});

Deno.test("bare uuid → kind=uuid", () => {
  const r = parseBepaidTrackingId(ORDER);
  assertEquals(r.kind, "uuid");
  assertEquals(r.orderId, ORDER);
});

Deno.test("uuid_uuid → kind=uuid_pair", () => {
  const r = parseBepaidTrackingId(`${ORDER}_${OFFER}`);
  assertEquals(r.kind, "uuid_pair");
  assertEquals(r.orderId, ORDER);
  assertEquals(r.offerId, OFFER);
});

Deno.test("null / empty → kind=unknown", () => {
  assertEquals(parseBepaidTrackingId(null).kind, "unknown");
  assertEquals(parseBepaidTrackingId("").kind, "unknown");
});

Deno.test("malformed subv2 → still classified as subv2 (manual review)", () => {
  const r = parseBepaidTrackingId("subv2:not-a-uuid");
  assertEquals(r.kind, "subv2");
  assertEquals(r.subscriptionV2Id, null);
});

Deno.test("garbage → kind=unknown (never silently match)", () => {
  assertEquals(parseBepaidTrackingId("769163216/94309").kind, "unknown");
  assertEquals(parseBepaidTrackingId("nika.1900735@mail.ru").kind, "unknown");
});
