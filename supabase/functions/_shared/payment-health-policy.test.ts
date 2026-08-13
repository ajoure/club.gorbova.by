import { assertEquals } from "jsr:@std/assert";
import {
  evaluateCronRuns,
  evaluateWebhookDelivery,
  isProviderRenewalOverdue,
} from "./payment-health-policy.ts";

const NOW = Date.parse("2026-08-13T08:00:00.000Z");

Deno.test("renewal is not critical inside the 24 hour provider grace window", () => {
  assertEquals(isProviderRenewalOverdue({
    state: "active",
    next_charge_at: "2026-08-13T03:01:00.000Z",
    last_charge_at: null,
  }, NOW), false);
});

Deno.test("renewal is critical after grace when no later charge exists", () => {
  assertEquals(isProviderRenewalOverdue({
    state: "active",
    next_charge_at: "2026-08-11T03:01:00.000Z",
    last_charge_at: null,
  }, NOW), true);
});

Deno.test("renewal is healthy when last charge covers scheduled charge", () => {
  assertEquals(isProviderRenewalOverdue({
    state: "active",
    next_charge_at: "2026-08-11T03:01:00.000Z",
    last_charge_at: "2026-08-11T03:02:00.000Z",
  }, NOW), false);
});

Deno.test("quiet bePaid window is not reported as delivery outage", () => {
  assertEquals(evaluateWebhookDelivery({
    webhookCount: 0,
    successfulPaymentCount: 0,
    queryFailed: false,
  }), { passed: true, quietWindow: true });
});

Deno.test("missing webhook with payment evidence stays actionable", () => {
  assertEquals(evaluateWebhookDelivery({
    webhookCount: 0,
    successfulPaymentCount: 1,
    queryFailed: false,
  }), { passed: false, quietWindow: false });
});

Deno.test("cron audit evidence prevents false critical when RPC is unavailable", () => {
  assertEquals(evaluateCronRuns({
    successfulRpcRuns: 0,
    cronAuditRows: 12,
    rpcFailed: true,
  }), { passed: true, source: "audit_fallback", count: 12 });
});
