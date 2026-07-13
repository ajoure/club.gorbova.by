/**
 * PATCH-GRANT-ACCESS-ELIGIBILITY-V1 / ELIG-C1-SHADOW
 *
 * Unit tests for the pure eligibility helper.
 * No IO. No production data. Fully synthetic fixtures.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateGrantEligibility,
  CANONICAL_PROVIDERS,
} from "../../supabase/functions/_shared/grant-eligibility.ts";

const baseOrder = (over: Record<string, any> = {}) => ({
  id: "ord_test",
  user_id: "u1",
  product_id: "p1",
  status: "paid",
  final_price: 100,
  paid_amount: 100,
  currency: "BYN",
  is_trial: false,
  meta: {},
  ...over,
});

const succeededPayment = (over: Record<string, any> = {}) => ({
  id: "pay_1",
  provider: "bepaid",
  provider_payment_id: "bp_1",
  transaction_type: "payment",
  status: "succeeded",
  amount: 100,
  currency: "BYN",
  refunded_amount: 0,
  meta: {},
  deleted_at: null,
  order_id: "ord_test",
  ...over,
});

describe("ELIG-C1 · four-provider canonical allowlist", () => {
  it("accepts bepaid | stripe | rr | bank as canonical", () => {
    for (const provider of CANONICAL_PROVIDERS) {
      const res = evaluateGrantEligibility({
        branch: "standard",
        callerType: "service_role",
        order: baseOrder(),
        payments: [succeededPayment({ provider })],
      });
      expect(res.reason).toBe("allow_paid_canonical_candidate");
      expect(res.would_allow).toBe(true);
      expect(res.evidence.provider_set).toEqual([provider]);
    }
  });

  it("rejects non-canonical provider 'admin_test' as test/sandbox-only (would_deny_test_payment)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ provider: "admin_test" })],
    });
    // ELIG-C1R correction #2: admin_test succeeded row is classified as
    // test/sandbox regardless of canonical allowlist. With no live
    // canonical row present the verdict is would_deny_test_payment.
    expect(res.reason).toBe("would_deny_test_payment");
    expect(res.would_allow).toBe(false);
  });
});

describe("ELIG-C1R · status=='succeeded' is the only canonical proof-of-payment", () => {
  it("payment status='paid' is NOT canonical succeeded", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ status: "paid" })],
    });
    // Should NOT be allow_paid_canonical_candidate — legacy `paid` string
    // is not accepted as succeeded.
    expect(res.reason).not.toBe("allow_paid_canonical_candidate");
    expect(res.evidence.canonical_payment_count).toBe(0);
  });

  it("payment status='SUCCEEDED' (case-insensitive) counts as succeeded", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ status: "SUCCEEDED" })],
    });
    expect(res.reason).toBe("allow_paid_canonical_candidate");
  });
});

describe("ELIG-C1R · test/sandbox classification across all providers", () => {
  it("admin provider succeeded → would_deny_test_payment", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ provider: "admin" })],
    });
    expect(res.reason).toBe("would_deny_test_payment");
  });

  it("admin_test provider succeeded → would_deny_test_payment", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ provider: "admin_test" })],
    });
    expect(res.reason).toBe("would_deny_test_payment");
  });

  it("rr with meta.env='test' → would_deny_test_payment", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ provider: "rr", meta: { env: "test" } })],
    });
    expect(res.reason).toBe("would_deny_test_payment");
  });

  it("stripe with livemode=false → would_deny_test_payment", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ provider: "stripe", meta: { livemode: false } })],
    });
    expect(res.reason).toBe("would_deny_test_payment");
  });

  it("live canonical + test payment together → live evidence wins (not hidden)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [
        succeededPayment({ id: "live", provider: "bepaid" }),
        succeededPayment({ id: "test", provider: "admin_test" }),
      ],
    });
    expect(res.reason).toBe("allow_paid_canonical_candidate");
    expect(res.evidence.test_or_sandbox_only).toBe(false);
    expect(res.evidence.canonical_payment_count).toBe(1);
  });
});

describe("ELIG-C1R · exclusions", () => {
  it("excludes deleted payments", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment({ deleted_at: "2026-01-01T00:00:00Z" })],
    });
    expect(res.reason).toBe("manual_review_ambiguous");
    expect(res.evidence.canonical_payment_count).toBe(0);
  });
});

describe("ELIG-C1R · evidence-load failure short-circuits to manual review", () => {
  it("paymentsLoadFailed → manual_review_evidence_load_failed", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [],
      paymentsLoadFailed: true,
    });
    expect(res.reason).toBe("manual_review_evidence_load_failed");
    expect(res.would_allow).toBeNull();
    expect(res.evidence.evidence_load_failures).toContain("payments_load_failed");
  });

  it("entitlementLoadFailed on admin edit → manual_review_evidence_load_failed", () => {
    const res = evaluateGrantEligibility({
      branch: "adminManualAccessEdit",
      callerType: "admin",
      order: baseOrder(),
      payments: [],
      entitlementLoadFailed: true,
    });
    expect(res.reason).toBe("manual_review_evidence_load_failed");
    expect(res.evidence.evidence_load_failures).toContain("entitlement_load_failed");
  });

  it("subscriptionLoadFailed → manual_review_evidence_load_failed", () => {
    const res = evaluateGrantEligibility({
      branch: "adminManualAccessEdit",
      callerType: "admin",
      order: baseOrder(),
      payments: [],
      subscriptionLoadFailed: true,
    });
    expect(res.reason).toBe("manual_review_evidence_load_failed");
    expect(res.evidence.evidence_load_failures).toContain("subscription_load_failed");
  });
});

describe("ELIG-C1R · admin edit accepts subscription as existing access", () => {
  it("admin edit with existing subscription (no entitlement) → allow_admin_edit_existing_candidate", () => {
    const res = evaluateGrantEligibility({
      branch: "adminManualAccessEdit",
      callerType: "admin",
      order: baseOrder(),
      payments: [],
      existingEntitlement: null,
      existingSubscription: { id: "sub_1", status: "active" },
    });
    expect(res.reason).toBe("allow_admin_edit_existing_candidate");
    expect(res.evidence.existing_subscription).toBe(true);
    expect(res.evidence.existing_entitlement).toBe(false);
  });
});

describe("ELIG-C1R · net_paid is null until C2 lands financial truth", () => {
  it("refund evidence present → net_paid=null (gross_succeeded still reported)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [
        succeededPayment({ id: "parent" }),
        {
          id: "refund",
          provider: "bepaid",
          transaction_type: "refund",
          status: "refunded",
          amount: -50,
          currency: "BYN",
          meta: { type: "refund" },
          deleted_at: null,
        },
      ],
    });
    expect(res.evidence.net_paid).toBeNull();
    expect(res.evidence.gross_succeeded).toBe(100);
  });

  it("multiple succeeded canonical payments → net_paid=null", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [
        succeededPayment({ id: "a" }),
        succeededPayment({ id: "b", provider_payment_id: "bp_2" }),
      ],
    });
    expect(res.evidence.net_paid).toBeNull();
    expect(res.evidence.gross_succeeded).toBe(200);
  });

  it("single clean succeeded payment → net_paid equals gross_succeeded", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment()],
    });
    expect(res.evidence.net_paid).toBe(100);
    expect(res.evidence.gross_succeeded).toBe(100);
  });
});


describe("ELIG-C1 · amount and currency", () => {
  it("currency conflict → manual review", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({ currency: "BYN" }),
      payments: [succeededPayment({ currency: "USD" })],
    });
    expect(res.reason).toBe("manual_review_currency_conflict");
    expect(res.would_allow).toBeNull();
  });

  it("insufficient amount → manual review", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({ final_price: 200 }),
      payments: [succeededPayment({ amount: 100 })],
    });
    expect(res.reason).toBe("manual_review_insufficient_amount");
  });

  it("multiple succeeded payments → manual review", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [
        succeededPayment({ id: "a" }),
        succeededPayment({ id: "b", provider_payment_id: "bp_2" }),
      ],
    });
    expect(res.reason).toBe("manual_review_multiple_succeeded_payments");
  });
});

describe("ELIG-C1 · refund ambiguity", () => {
  it("refund row present alongside succeeded parent → manual review (refund_ambiguous)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [
        succeededPayment({ id: "parent" }),
        {
          id: "refund",
          provider: "bepaid",
          transaction_type: "refund",
          status: "refunded",
          amount: -50,
          currency: "BYN",
          meta: { type: "refund", parent_payment_id: "parent" },
          deleted_at: null,
          order_id: "ord_test",
        },
      ],
    });
    expect(res.reason).toBe("manual_review_refund_ambiguous");
  });

  it("refund row + parent refunded_amount → financial_truth_pending_c2", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder(),
      payments: [
        succeededPayment({ id: "parent", refunded_amount: 50 }),
        succeededPayment({ id: "p2", provider_payment_id: "bp_2" }),
        {
          id: "refund",
          provider: "bepaid",
          transaction_type: "refund",
          status: "refunded",
          amount: -50,
          currency: "BYN",
          meta: { type: "refund" },
          deleted_at: null,
        },
      ],
    });
    expect(res.reason).toBe("manual_review_financial_truth_pending_c2");
  });

  it("status=refunded → would_deny_refunded", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({ status: "refunded" }),
      payments: [succeededPayment({ refunded_amount: 100 })],
    });
    expect(res.reason).toBe("would_deny_refunded");
    expect(res.would_allow).toBe(false);
  });
});

describe("ELIG-C1 · deal_only semantics", () => {
  it("exact meta.source=admin_deal_only → deny", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({ meta: { source: "admin_deal_only" } }),
      payments: [],
    });
    expect(res.reason).toBe("would_deny_deal_only");
  });

  it("meta.deal_only=true with unrelated source → NOT auto-denied (manual review)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({
        status: "created",
        paid_amount: 0,
        meta: { deal_only: true, source: "checkout" },
      }),
      payments: [],
    });
    expect(res.reason).not.toBe("would_deny_deal_only");
    // With status 'created' + no payment we hit would_deny_unpaid first —
    // that is expected; the invariant is that we don't blanket-deny 1426 orders.
    expect([
      "manual_review_legacy_deal_only_semantics",
      "would_deny_unpaid",
    ]).toContain(res.reason);
  });
});

describe("ELIG-C1 · admin gift strict contract", () => {
  const gift = () =>
    baseOrder({
      status: "paid",
      final_price: 0,
      paid_amount: 0,
      meta: { source: "admin_grant" },
    });

  it("admin caller + strict contract → allow_admin_gift", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "admin",
      order: gift(),
      payments: [],
    });
    expect(res.reason).toBe("allow_admin_gift");
    expect(res.would_allow).toBe(true);
  });

  it("service_role cannot use admin_gift exception (falls through to ambiguous)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: gift(),
      payments: [],
    });
    expect(res.reason).not.toBe("allow_admin_gift");
  });

  it("admin_grant with deal_only=true is disqualified from gift", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "admin",
      order: baseOrder({
        status: "paid",
        final_price: 0,
        paid_amount: 0,
        meta: { source: "admin_grant", deal_only: true },
      }),
      payments: [],
    });
    expect(res.reason).not.toBe("allow_admin_gift");
  });

  it("admin_grant with a canonical succeeded payment is disqualified from gift", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "admin",
      order: baseOrder({
        final_price: 0,
        paid_amount: 0,
        meta: { source: "admin_grant" },
      }),
      payments: [succeededPayment({ amount: 0 })],
    });
    // Falls through to insufficient-amount check would compare 0 vs 0 → not insufficient.
    // Correct expectation: not admin_gift.
    expect(res.reason).not.toBe("allow_admin_gift");
  });
});

describe("ELIG-C1 · trial and legacy", () => {
  it("trial → manual_review_trial_contract_unverified (not allow)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({
        is_trial: true,
        final_price: 1,
        paid_amount: 0,
        status: "created",
        meta: { source: "trial_no_card" },
      }),
      payments: [],
    });
    // status=created blocks first → would_deny_unpaid. But if we adjust
    // status to something that would otherwise allow, trial must gate.
    expect([
      "manual_review_trial_contract_unverified",
      "would_deny_unpaid",
    ]).toContain(res.reason);

    const res2 = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({
        is_trial: true,
        final_price: 1,
        paid_amount: 1,
        status: "trialing",
        meta: {},
      }),
      payments: [],
    });
    expect(res2.reason).toBe("manual_review_trial_contract_unverified");
    expect(res2.would_allow).toBeNull();
  });

  it("legacy backfill → manual review (not auto-allowed)", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({
        status: "legacy",
        paid_amount: 0,
        meta: { source: "legacy_backfill" },
      }),
      payments: [],
    });
    expect(res.reason).toBe("manual_review_legacy_backfill");
    expect(res.would_allow).toBeNull();
  });
});

describe("ELIG-C1 · admin edit branch", () => {
  it("admin edit with existing entitlement → allow_admin_edit_existing_candidate", () => {
    const res = evaluateGrantEligibility({
      branch: "adminManualAccessEdit",
      callerType: "admin",
      order: baseOrder(),
      payments: [],
      existingEntitlement: { id: "ent_1", expires_at: "2027-01-01T00:00:00Z" },
    });
    expect(res.reason).toBe("allow_admin_edit_existing_candidate");
  });

  it("admin edit without existing entitlement → manual_review", () => {
    const res = evaluateGrantEligibility({
      branch: "adminManualAccessEdit",
      callerType: "admin",
      order: baseOrder(),
      payments: [],
      existingEntitlement: null,
    });
    expect(res.reason).toBe("manual_review_admin_edit_without_access");
  });
});

describe("ELIG-C1 · status/payment conflict", () => {
  it("failed order with succeeded canonical payment → conflict", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({ status: "failed" }),
      payments: [succeededPayment()],
    });
    expect(res.reason).toBe("manual_review_status_payment_conflict");
  });

  it("pending order without any payment → would_deny_unpaid", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({ status: "pending", paid_amount: 0 }),
      payments: [],
    });
    expect(res.reason).toBe("would_deny_unpaid");
  });

  it("failed order without any payment → would_deny_failed", () => {
    const res = evaluateGrantEligibility({
      branch: "standard",
      callerType: "service_role",
      order: baseOrder({ status: "failed", paid_amount: 0 }),
      payments: [],
    });
    expect(res.reason).toBe("would_deny_failed");
  });
});

describe("ELIG-C1 · 3ds / renewal branches (candidate only, no block)", () => {
  it("3ds_finalize → allow_3ds_finalize_candidate", () => {
    const res = evaluateGrantEligibility({
      branch: "3ds_finalize",
      callerType: "service_role",
      order: baseOrder({ status: "pending" }),
      payments: [],
    });
    expect(res.reason).toBe("allow_3ds_finalize_candidate");
    expect(res.would_allow).toBe(true);
  });

  it("subscription_renewal → allow_subscription_renewal_candidate", () => {
    const res = evaluateGrantEligibility({
      branch: "subscription_renewal",
      callerType: "service_role",
      order: baseOrder(),
      payments: [succeededPayment()],
    });
    expect(res.reason).toBe("allow_subscription_renewal_candidate");
  });

  it("refunded 3ds_finalize still denies", () => {
    const res = evaluateGrantEligibility({
      branch: "3ds_finalize",
      callerType: "service_role",
      order: baseOrder({ status: "refunded" }),
      payments: [],
    });
    expect(res.reason).toBe("would_deny_refunded");
  });
});
