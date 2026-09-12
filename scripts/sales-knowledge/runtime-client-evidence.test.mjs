import test from "node:test";
import assert from "node:assert/strict";
import {
  accessIsActive,
  assertClientIdentity,
  buildAttendance,
  classifyOrder,
} from "../../supabase/functions/_shared/sales-runtime/client-evidence.mjs";
const order = {
  id: "order",
  status: "paid",
  final_price: 100,
  currency: "BYN",
  created_at: "2026-01-01",
  is_trial: false,
  is_deleted: false,
};
const payment = {
  id: "payment",
  order_id: "order",
  status: "succeeded",
  amount: 100,
  currency: "BYN",
  provider: "test-provider",
  provider_payment_id: "receipt",
  transaction_type: "payment",
};
test("paid status, a free order and a trial do not establish a paid purchase", () => {
  assert.equal(
    classifyOrder(order, []).classification,
    "paid_status_without_payment_proof",
  );
  assert.equal(
    classifyOrder({ ...order, final_price: 0 }, []).classification,
    "zero_price_order",
  );
  assert.equal(
    classifyOrder({ ...order, is_trial: true }, [payment]).classification,
    "trial",
  );
  assert.equal(classifyOrder(order, [payment]).classification, "paid_purchase");
  assert.equal(classifyOrder({...order,final_price:0},[payment]).classification,'payment_review_required');
});
test("deleted, foreign-currency, authorization and synthetic payments cannot prove payment", () => {
  for (
    const patch of [
      { is_deleted: true },
      { currency: "USD" },
      { transaction_type: "authorization" },
      { is_test: true },
      { fixture: true },
    ]
  ) {
    assert.notEqual(
      classifyOrder(order, [{ ...payment, ...patch }]).classification,
      "paid_purchase",
    );
  }
  assert.equal(
    classifyOrder({ ...order, is_deleted: true }, [payment]).classification,
    "deleted_excluded",
  );
});
test("partial payment, duplicate receipt and override are reviewable rather than paid", () => {
  assert.equal(
    classifyOrder(order, [{ ...payment, amount: 50 }]).classification,
    "partial_or_inconsistent_payment",
  );
  assert.equal(
    classifyOrder(order, [payment, { ...payment, id: "duplicate" }])
      .classification,
    "payment_review_required",
  );
  assert.equal(
    classifyOrder(order, [payment], [], [], [{
      provider: payment.provider,
      uid: "receipt",
    }]).classification,
    "payment_review_required",
  );
});
test("refund journals are signals, not amounts to sum or new purchase proof", () => {
  for(const transaction_type of ['возврат средств','ОТМЕНА','void','refund','chargeback']) {
    const r=classifyOrder(order,[payment,{...payment,id:'reversal',provider_payment_id:'reversal-receipt',transaction_type,status:'succeeded'}]);
    assert.equal(r.classification,'refund_or_refund_review');
  }
  for (
    const [o, p, r, a] of [
      [{ ...order, status: "refunded" }, [payment], [], []],
      [order, [{ ...payment, refunded_amount: 10 }], [], []],
      [order, [payment], [{ order_id: "order", state: "unknown" }], []],
      [order, [payment], [], [{ payment_id: "payment", refunded_amount: 10 }]],
    ]
  ) {
    assert.equal(
      classifyOrder(o, p, r, a).classification,
      "refund_or_refund_review",
    );
  }
  assert.equal(
    classifyOrder(order, [payment], [{ order_id: "order", state: "failed" }])
      .classification,
    "paid_purchase",
  );
});
test("identity conflict cannot be hidden by one matching identity column", () => {
  assertClientIdentity(
    [{ user_id: "user", profile_id: "profile" }, {
      user_id: null,
      profile_id: "profile",
    }],
    "user",
    "profile",
  );
  for (
    const row of [{ user_id: "user", profile_id: "foreign" }, {
      user_id: "foreign",
      profile_id: "profile",
    }, {}]
  ) {
    assert.throws(
      () => assertClientIdentity([row], "user", "profile"),
      /identity_conflict/,
    );
  }
});
test("access follows its own dates/status and does not follow refund or payment assumptions", () => {
  const at = "2026-09-12T12:00:00Z";
  assert.equal(
    accessIsActive({ status: "active", expires_at: "2026-10-01" }, at),
    true,
  );
  for (
    const row of [{ status: "revoked" }, { status: "active", revoked_at: at }, {
      status: "active",
      starts_at: "2026-10-01",
    }, { status: "active", expires_at: at }]
  ) assert.equal(accessIsActive(row, at), false);
});
test("registration, comment, room endpoints and seek-to-end remain separate evidence", () => {
  const [a] = buildAttendance({
    events: [{ id: "event", title: "Эфир" }],
    proofs: [{ live_event_id: "event", created_at: "t1" }],
    rooms: [{ live_event_id: "event", created_at: "t1", last_seen_at: "t2" }],
    sessions: [{ id: "session", live_event_id: "event" }],
    progress: [{
      session_id: "session",
      max_watched_seconds: 3600,
      completed_at: "t2",
    }],
    comments: [{ live_event_id: "event", created_at: "t1" }],
  });
  assert.equal(a.watched_duration_seconds, null);
  assert.equal(a.completion_verified, false);
  assert.equal(a.player_evidence[0].furthest_position_seconds, 3600);
  assert.equal(a.interactions[0].kind, "comment");
  assert.equal(a.access_records[0].kind, "access_granted_not_attendance");
  assert.equal(a.room_presence.length, 1);
  assert.equal(a.scheduled_sessions[0].kind, "session_created_not_attendance");
});
test("empty evidence never invents attendance, and order creation date is labelled", () => {
  assert.deepEqual(buildAttendance({}), []);
  const [a] = buildAttendance({ events: [{ id: "event" }] });
  assert.deepEqual(a.room_presence, []);
  assert.equal(a.completion_verified, false);
  assert.equal(classifyOrder(order, []).date_kind, "order_created_at");
  assert.equal(
    classifyOrder({ ...order, deal_date: "2024-02-01" }, []).date_kind,
    "deal_date",
  );
});
