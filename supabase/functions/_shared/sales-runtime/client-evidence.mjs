// Facts about records, not assumptions about learning, payment settlement or intent.
const positive = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;
export function assertClientIdentity(rows, userId, profileId) {
  for (const row of rows) {
    if (
      (!row.user_id && !row.profile_id) ||
      (row.user_id && row.user_id !== userId) ||
      (row.profile_id && row.profile_id !== profileId)
    ) throw Error("client_evidence_identity_conflict");
  }
}
export function accessIsActive(row, at) {
  return row.status === "active" && !row.revoked_at &&
    (!row.starts_at || Date.parse(row.starts_at) <= Date.parse(at)) &&
    (!row.expires_at || Date.parse(row.expires_at) > Date.parse(at));
}

/** No refund amounts are added across journals: a refund signal requires review.
 * A paid status alone remains visible but cannot establish a paid purchase. */
export function classifyOrder(
  order,
  payments,
  requests = [],
  allocations = [],
  overrides = [],
) {
  const rows = payments.filter((p) => p.order_id === order.id && !p.is_deleted);
  const paymentIds = new Set(rows.map((p) => p.id));
  const refs = rows.map((p) =>
    p.provider && p.provider_payment_id
      ? p.provider + ":" + p.provider_payment_id
      : null
  ).filter(Boolean);
  const duplicate = new Set(refs).size !== refs.length;
  const overridden = rows.some((p) =>
    overrides.some((o) =>
      o.provider === p.provider && o.uid === p.provider_payment_id
    )
  );
  const refundRequest = requests.some((r) =>
    (r.order_id === order.id || paymentIds.has(r.payment_id)) &&
    r.state !== "failed"
  );
  const refund = order.status === "refunded" ||
    rows.some((p) =>
      p.status === "refunded" || positive(p.refunded_amount) ||
      p.transaction_type === "refund"
    ) ||
    allocations.some((a) =>
      paymentIds.has(a.payment_id) && positive(a.refunded_amount)
    );
  const paid = rows.filter((p) =>
    p.status === "succeeded" && positive(p.amount) &&
    p.currency === order.currency &&
    p.is_test !== true && p.fixture !== true &&
    (p.transaction_type == null ||
      [
        "payment",
        "subscription",
        "capture",
        "sale",
        "оплата",
        "платеж",
        "платёж",
        "рекуррентная транзакция",
      ].includes(String(p.transaction_type).trim().toLowerCase()))
  );
  const amount = paid.reduce((n, p) => n + p.amount, 0);
  let classification;
  if (order.is_deleted) classification = "deleted_excluded";
  else if (refund || refundRequest) classification = "refund_or_refund_review";
  else if (duplicate || overridden) classification = "payment_review_required";
  else if (order.is_trial) classification = "trial";
  else if (order.final_price === 0) classification = "zero_price_order";
  else if (
    order.status === "paid" && positive(order.final_price) &&
    amount >= order.final_price
  ) classification = "paid_purchase";
  else if (positive(amount)) classification = "partial_or_inconsistent_payment";
  else if (order.status === "paid") {
    classification = "paid_status_without_payment_proof";
  } else classification = "unpaid_or_unverified";
  return {
    classification,
    order_status: order.status,
    payment_evidence: classification === "paid_purchase"
      ? "succeeded_payment_records"
      : "not_confirmed",
    refund_signal: refund,
    refund_request_pending_or_recorded: refundRequest,
    payment_override_present: overridden,
    duplicate_payment_reference: duplicate,
    // Do not call this net paid: refund sources can overlap and need reconciliation.
    succeeded_amount_in_order_currency: amount,
    currency: order.currency,
    recorded_order_date: order.deal_date || order.created_at,
    date_kind: order.deal_date ? "deal_date" : "order_created_at",
    learner_status: "unknown",
  };
}

/** Room endpoints and player position are not contiguous watch intervals. Even
 * completed_at/watch_percent can be position-derived, so never promote them.
 * @param {{events?:any[],rooms?:any[],proofs?:any[],sessions?:any[],progress?:any[],comments?:any[],questions?:any[],reactions?:any[]}} input */
export function buildAttendance(
  {
    events = [],
    rooms = [],
    proofs = [],
    sessions = [],
    progress = [],
    comments = [],
    questions = [],
    reactions = [],
  },
) {
  return events.map((event) => {
    const eventSessions = sessions.filter((s) => s.live_event_id === event.id);
    const sessionIds = new Set(eventSessions.map((s) => s.id));
    return {
      event_id: event.id,
      title: event.title,
      event_type: event.event_type,
      source_kind: event.source_kind,
      scheduled_at: event.scheduled_at,
      access_records: proofs.filter((p) => p.live_event_id === event.id).map(
        (p) => ({ at: p.created_at, kind: "access_granted_not_attendance" }),
      ),
      room_presence: rooms.filter((r) => r.live_event_id === event.id).map(
        (r) => ({
          first_recorded_at: r.created_at,
          last_heartbeat_at: r.last_seen_at,
          revoked_at: r.revoked_at,
          kind: "room_open_and_heartbeat_endpoints",
        }),
      ),
      scheduled_sessions: eventSessions.map((s) => ({
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        mode: s.mode,
        kind: "session_created_not_attendance",
      })),
      player_evidence: progress.filter((p) => sessionIds.has(p.session_id)).map(
        (p) => ({
          first_recorded_at: p.first_joined_at,
          last_heartbeat_at: p.last_seen_at,
          last_position_seconds: p.last_video_position_seconds,
          furthest_position_seconds: p.max_watched_seconds,
          reported_completed_at: p.completed_at,
          kind: "player_position_not_watch_duration",
        }),
      ),
      interactions: [
        ...comments.filter((r) => r.live_event_id === event.id).map((r) => ({
          kind: "comment",
          at: r.created_at,
        })),
        ...questions.filter((r) => r.live_event_id === event.id).map((r) => ({
          kind: "question",
          at: r.created_at,
        })),
        ...reactions.filter((r) => r.live_event_id === event.id).map((r) => ({
          kind: "reaction",
          at: r.created_at,
        })),
      ],
      watched_duration_seconds: null,
      completion_verified: false,
    };
  });
}
