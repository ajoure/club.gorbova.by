// PATCH-VERONIKA-MATUK-GORBOVA-CLUB-REPAIR
// Single shared parser for bePaid `tracking_id` formats. Used by
// `bepaid-webhook` and `bepaid-fetch-transactions` so the recurring
// (`subv2:*`) format is recognised everywhere — not just in the webhook.
//
// Supported formats (id-first only, no product code / slug):
//   subv2:{subscription_v2_id}:order:{order_id}   — canonical recurring
//   subv2:{subscription_v2_id}                    — legacy recurring (no order)
//   link:order:{order_id}                         — public link with order
//   link:{order_id}                               — public link
//   {order_id}                                    — bare uuid
//   {order_id}_{offer_id}                         — uuid pair (legacy)
//
// On `unknown` callers must NOT silently fail: send to manual review queue
// and emit an audit event. Never guess from email or amount.

export type BepaidTrackingKind =
  | "subv2"
  | "link_order"
  | "link"
  | "uuid"
  | "uuid_pair"
  | "unknown";

export type BepaidTrackingParse = {
  kind: BepaidTrackingKind;
  orderId: string | null;
  offerId: string | null;
  subscriptionV2Id: string | null;
  raw: string | null;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

export function parseBepaidTrackingId(
  raw: string | null | undefined,
): BepaidTrackingParse {
  const value = (raw ?? null) as string | null;
  if (!value) {
    return { kind: "unknown", orderId: null, offerId: null, subscriptionV2Id: null, raw: value };
  }

  // subv2:{sub_id}:order:{order_id} — canonical recurring tracking
  const strictSubv2Order = value.match(
    new RegExp(`^subv2:(${UUID}):order:(${UUID})$`, "i"),
  );
  if (strictSubv2Order) {
    return {
      kind: "subv2",
      orderId: strictSubv2Order[2],
      offerId: null,
      subscriptionV2Id: strictSubv2Order[1],
      raw: value,
    };
  }

  // tolerant subv2:{any}:order:{any} (back-compat with non-uuid placeholders)
  const looseSubv2Order = value.match(/^subv2:([^:]+):order:(.+)$/i);
  if (looseSubv2Order) {
    return {
      kind: "subv2",
      orderId: looseSubv2Order[2],
      offerId: null,
      subscriptionV2Id: looseSubv2Order[1],
      raw: value,
    };
  }

  // legacy subv2:{sub_id}
  const simpleSubv2 = value.match(new RegExp(`^subv2:(${UUID})$`, "i"));
  if (simpleSubv2) {
    return {
      kind: "subv2",
      orderId: null,
      offerId: null,
      subscriptionV2Id: simpleSubv2[1],
      raw: value,
    };
  }

  // anything starting with subv2: but not matching above — still recurring
  if (value.toLowerCase().startsWith("subv2:")) {
    return { kind: "subv2", orderId: null, offerId: null, subscriptionV2Id: null, raw: value };
  }

  const linkOrder = value.match(new RegExp(`^link:order:(${UUID})(?:$|:)`, "i"));
  if (linkOrder) {
    return { kind: "link_order", orderId: linkOrder[1], offerId: null, subscriptionV2Id: null, raw: value };
  }

  const link = value.match(new RegExp(`^link:(${UUID})(?:$|:)`, "i"));
  if (link) {
    return { kind: "link", orderId: link[1], offerId: null, subscriptionV2Id: null, raw: value };
  }

  const parts = value.split("_");
  if (parts.length >= 1 && UUID_RE.test(parts[0])) {
    const orderId = parts[0];
    const offerId = parts.length >= 2 && UUID_RE.test(parts[1]) ? parts[1] : null;
    return {
      kind: offerId ? "uuid_pair" : "uuid",
      orderId,
      offerId,
      subscriptionV2Id: null,
      raw: value,
    };
  }

  return { kind: "unknown", orderId: null, offerId: null, subscriptionV2Id: null, raw: value };
}
