import { DB, read } from "./db.ts";
import { readFullHistory } from "./history.mjs";
import {
  accessIsActive,
  assertClientIdentity,
  buildAttendance,
  classifyOrder,
} from "./client-evidence.mjs";

const pages = (query: (from: number, to: number) => any) =>
  readFullHistory((from: number, to: number) => read(query(from, to)));
// Bound IN lists as well as result pages. A missing page/query is an error, not
// an empty history. No email/name matching or external provider calls.
async function byIds(
  db: DB,
  table: string,
  fields: string,
  column: string,
  ids: string[],
  at: string,
  order = "id",
) {
  const result: any[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let n = 0; n < unique.length; n += 100) {
    result.push(
      ...await pages((from, to) =>
        db.from(table).select(fields)
          .in(column, unique.slice(n, n + 100)).lte("created_at", at).order(
            order,
          ).range(from, to)
      ),
    );
  }
  return result;
}
export async function loadClientEvidence(
  db: DB,
  userId: string,
  profileId: string,
  productId: string,
  at: string,
  comments: any[],
) {
  const identity = `user_id.eq.${userId},profile_id.eq.${profileId}`;
  const own = (table: string, fields: string) =>
    pages((from, to) =>
      db.from(table).select(fields).or(identity).lte("created_at", at).order(
        "id",
      ).range(from, to)
    );
  const ownUser = (table: string, fields: string, column = "user_id") =>
    pages((from, to) =>
      db.from(table).select(fields).eq(column, userId).lte("created_at", at)
        .order("id").range(from, to)
    );
  const [
    allOrders,
    ownPayments,
    entitlements,
    sources,
    rooms,
    proofs,
    personalSessions,
    progress,
    questions,
    reactions,
  ] = await Promise.all([
    own(
      "orders_v2",
      "id,user_id,profile_id,product_id,status,final_price,currency,is_trial,is_deleted,deal_date,created_at",
    ),
    own(
      "payments_v2",
      "id,user_id,profile_id,order_id,status,amount,currency,is_deleted,provider,provider_payment_id,transaction_type,refunded_amount,is_test:meta->is_test,fixture:meta->fixture,created_at",
    ),
    own(
      "entitlements",
      "id,user_id,profile_id,order_id,product_id,status,expires_at,created_at",
    ),
    own(
      "entitlement_sources",
      "id,user_id,profile_id,order_id,product_id,source_type,status,starts_at,expires_at,revoked_at,created_at",
    ),
    ownUser(
      "live_active_sessions",
      "id,user_id,live_event_id,created_at,last_seen_at,revoked_at",
    ),
    ownUser("live_access_proofs", "id,user_id,live_event_id,created_at"),
    ownUser(
      "live_event_sessions",
      "id,viewer_user_id,live_event_id,starts_at,ends_at,mode,created_at",
      "viewer_user_id",
    ),
    ownUser(
      "live_event_session_progress",
      "id,viewer_user_id,session_id,first_joined_at,last_seen_at,last_video_position_seconds,max_watched_seconds,completed_at,created_at",
      "viewer_user_id",
    ),
    ownUser(
      "live_event_questions",
      "id,user_id,live_event_id,content,created_at",
    ),
    ownUser("live_event_reactions", "id,user_id,live_event_id,created_at"),
  ]);
  for (const rows of [allOrders, ownPayments, entitlements, sources]) {
    assertClientIdentity(rows, userId, profileId);
  }
  for (const rows of [rooms, proofs, questions, reactions]) {
    assertClientIdentity(rows, userId, profileId);
  }
  if (
    [...personalSessions, ...progress].some((r: any) =>
      r.viewer_user_id !== userId
    )
  ) throw Error("client_evidence_identity_conflict");
  const orders = allOrders.filter((o: any) => !o.is_deleted);
  // Order FK catches linked payments whose identity fields have not been filled.
  const linkedPayments = await byIds(
    db,
    "payments_v2",
    "id,user_id,profile_id,order_id,status,amount,currency,is_deleted,provider,provider_payment_id,transaction_type,refunded_amount,is_test:meta->is_test,fixture:meta->fixture,created_at",
    "order_id",
    orders.map((o: any) => o.id),
    at,
  );
  for (const row of linkedPayments) {
    if (row.user_id || row.profile_id) {
      assertClientIdentity([row], userId, profileId);
    }
  }
  const payments = [
    ...new Map([...ownPayments, ...linkedPayments].map((r: any) => [r.id, r]))
      .values(),
  ] as any[];
  const [requests, allocations, overrides, progressSessions] = await Promise
    .all([
      byIds(
        db,
        "payment_refund_requests",
        "request_key,order_id,payment_id,state,created_at",
        "order_id",
        orders.map((o: any) => o.id),
        at,
        "request_key",
      ),
      byIds(
        db,
        "payment_allocations",
        "id,payment_id,refunded_amount,created_at",
        "payment_id",
        payments.filter((p) => !p.is_deleted).map((p) => p.id),
        at,
      ),
      byIds(
        db,
        "payment_status_overrides",
        "id,uid,provider,status_override,created_at",
        "uid",
        payments.filter((p) => !p.is_deleted).map((p) => p.provider_payment_id),
        at,
      ),
      byIds(
        db,
        "live_event_sessions",
        "id,viewer_user_id,live_event_id,starts_at,ends_at,mode,created_at",
        "id",
        progress.map((p: any) => p.session_id),
        at,
      ),
    ]);
  // Shared sessions have no viewer, but a personal session must match the actor.
  if (
    progressSessions.some((s) =>
      s.viewer_user_id && s.viewer_user_id !== userId
    )
  ) throw Error("client_evidence_identity_conflict");
  if (
    progress.some((p: any) =>
      !progressSessions.some((s) => s.id === p.session_id)
    )
  ) throw Error("client_evidence_missing_session");
  const sessions = [
    ...new Map(
      [...personalSessions, ...progressSessions].map((r: any) => [r.id, r]),
    ).values(),
  ] as any[];
  const eventIds = [
    ...rooms,
    ...proofs,
    ...sessions,
    ...comments,
    ...questions,
    ...reactions,
  ].map((r: any) => r.live_event_id);
  const [events, products] = await Promise.all([
    byIds(
      db,
      "live_events",
      "id,title,event_type,source_kind,scheduled_at,created_at",
      "id",
      eventIds,
      at,
    ),
    byIds(
      db,
      "products_v2",
      "id,name,created_at",
      "id",
      [...orders, ...entitlements, ...sources].map((o: any) => o.product_id),
      at,
    ),
  ]);
  const name = (id: string) =>
    products.find((p) => p.id === id)?.name ?? "unknown";
  const purchases = orders.map((o: any) => ({
    order_id: o.id,
    product_id: o.product_id,
    product: name(o.product_id),
    ...classifyOrder(o, payments, requests, allocations, overrides),
  }));
  const access = [
    ...entitlements.map((r: any) => ({
      source: "entitlements",
      source_type: null,
      product_id: r.product_id,
      product: name(r.product_id),
      status: r.status,
      expires_at: r.expires_at,
      active_as_recorded: accessIsActive(r, at),
      payment_proof: false,
    })),
    ...sources.map((r: any) => ({
      source: "entitlement_sources",
      source_type: r.source_type,
      product_id: r.product_id,
      product: name(r.product_id),
      status: r.status,
      starts_at: r.starts_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      active_as_recorded: accessIsActive(r, at),
      payment_proof: false,
    })),
  ];
  const current = purchases.filter((p) => p.product_id === productId);
  return {
    purchases,
    access,
    current_course_paid: current.some((p) =>
      p.classification === "paid_purchase"
    ),
    // Conservative guard: don't generate another sale for an uncertain existing
    // paid/partial/refunded order or access. Let the owner reconcile it.
    current_course_checkout_hold:
      current.some((p) =>
        ["paid", "partial", "refunded"].includes(p.order_status) ||
        p.refund_signal || p.refund_request_pending_or_recorded ||
        p.payment_override_present || p.duplicate_payment_reference ||
        p.succeeded_amount_in_order_currency > 0
      ) || access.some((a) =>
        a.product_id === productId && a.active_as_recorded
      ),
    purchase_history_complete: false,
    purchase_history_status: "canonical_rows_read_external_history_unknown",
    canonical_read_at: at,
    excluded_deleted_orders: allOrders.length - orders.length,
    unlinked_payment_records:
      payments.filter((p) =>
        !p.is_deleted && !allOrders.some((o: any) => o.id === p.order_id)
      ).length,
    webinar_activity: buildAttendance({
      events,
      rooms,
      proofs,
      sessions,
      progress,
      comments,
      questions,
      reactions,
    }),
    webinar_questions: questions.map((q: any) => ({
      event_id: q.live_event_id,
      text: q.content,
      at: q.created_at,
    })),
    attendance_history_status: "available_authenticated_records_only",
  };
}
