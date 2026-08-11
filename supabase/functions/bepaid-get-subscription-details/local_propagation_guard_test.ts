import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyLocalPropagation } from "./local_propagation_guard.ts";

Deno.test("blocks a successful charge after local cancellation", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "active",
      hasCompetingActiveSubscription: false,
      localStatus: "canceled",
      autoRenew: false,
      canceledAt: "2026-08-10T11:10:00Z",
      autoRenewDisabledAt: null,
      currentAccessEnd: "2026-08-10T23:59:59Z",
      transactionStatus: "successful",
      transactionPaidAt: "2026-08-11T03:00:50Z",
      proposedAccessEnd: "2026-09-08T17:57:50Z",
    }).decision,
    "blocked_post_cancel_charge",
  );
});

Deno.test("allows a successful charge that predates cancellation", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "active",
      hasCompetingActiveSubscription: false,
      localStatus: "canceled",
      autoRenew: false,
      canceledAt: "2026-08-11T04:00:00Z",
      autoRenewDisabledAt: null,
      currentAccessEnd: "2026-09-08T17:57:50Z",
      transactionStatus: "successful",
      transactionPaidAt: "2026-08-11T03:00:50Z",
      proposedAccessEnd: "2026-09-08T17:57:50Z",
    }).decision,
    "allow",
  );
});

Deno.test("blocks an ambiguous terminal extension without stop timestamps", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "active",
      hasCompetingActiveSubscription: true,
      localStatus: "expired",
      autoRenew: false,
      canceledAt: null,
      autoRenewDisabledAt: null,
      currentAccessEnd: "2026-07-31T23:59:59Z",
      transactionStatus: "successful",
      transactionPaidAt: "2026-08-01T03:01:00Z",
      proposedAccessEnd: "2026-08-31T23:59:59Z",
    }).decision,
    "blocked_ambiguous_terminal_charge",
  );
});

Deno.test("allows an active subscription with no local stop", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "active",
      hasCompetingActiveSubscription: false,
      localStatus: "active",
      autoRenew: true,
      canceledAt: null,
      autoRenewDisabledAt: null,
      currentAccessEnd: "2026-08-10T23:59:59Z",
      transactionStatus: "successful",
      transactionPaidAt: "2026-08-11T03:00:50Z",
      proposedAccessEnd: "2026-09-08T17:57:50Z",
    }).decision,
    "allow",
  );
});

Deno.test("blocks non-successful transactions before date propagation", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "active",
      hasCompetingActiveSubscription: false,
      localStatus: "canceled",
      autoRenew: false,
      canceledAt: null,
      autoRenewDisabledAt: null,
      currentAccessEnd: null,
      transactionStatus: "failed",
      transactionPaidAt: null,
      proposedAccessEnd: null,
    }).decision,
    "blocked_transaction_not_successful",
  );
});

Deno.test("blocks failed provider state before date propagation", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "failed",
      hasCompetingActiveSubscription: false,
      localStatus: "expired",
      autoRenew: true,
      canceledAt: null,
      autoRenewDisabledAt: null,
      currentAccessEnd: "2026-07-01T23:59:59Z",
      transactionStatus: "failed",
      transactionPaidAt: null,
      proposedAccessEnd: "2026-08-01T23:59:59Z",
    }).decision,
    "blocked_provider_not_active",
  );
});

Deno.test("allows active paid provider coverage to restore a stale expired row", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "active",
      hasCompetingActiveSubscription: false,
      localStatus: "expired",
      autoRenew: false,
      canceledAt: null,
      autoRenewDisabledAt: null,
      currentAccessEnd: "2026-08-02T00:00:00Z",
      transactionStatus: "successful",
      transactionPaidAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString(),
      proposedAccessEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
        .toISOString(),
    }).decision,
    "allow",
  );
});

Deno.test("blocks a stale superseded row when a competing active subscription exists", () => {
  assertEquals(
    classifyLocalPropagation({
      providerState: "active",
      hasCompetingActiveSubscription: true,
      localStatus: "superseded",
      autoRenew: false,
      canceledAt: null,
      autoRenewDisabledAt: null,
      currentAccessEnd: "2026-08-02T00:00:00Z",
      transactionStatus: "successful",
      transactionPaidAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString(),
      proposedAccessEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
        .toISOString(),
    }).decision,
    "blocked_ambiguous_terminal_charge",
  );
});
