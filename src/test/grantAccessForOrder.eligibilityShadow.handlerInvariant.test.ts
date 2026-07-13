/**
 * PATCH-GRANT-ACCESS-ELIGIBILITY-V1 / ELIG-C1R
 *
 * Source-level invariant that the handler wires the shadow evaluation
 * WITHOUT enabling enforcement, in BOTH the standard flow and the
 * early 3ds_finalize branch:
 *
 *   authz → order lookup → shadow evaluation → grant flow
 *   authz → threeDsOrder lookup → shadow evaluation → handleThreeDsFinalize
 *
 * MUST be true:
 *   1. Shared runner `runGrantEligibilityShadow` exists and encapsulates
 *      the pure-helper call (`evaluateGrantEligibility`) — the handler
 *      body itself never calls the helper directly.
 *   2. The runner is invoked from within the ELIG-C1-SHADOW marker block
 *      in the standard flow.
 *   3. The runner is invoked from the 3ds_finalize branch BEFORE
 *      `handleThreeDsFinalize`.
 *   4. The runner call is never followed by a `return new Response`
 *      that depends on the shadow verdict.
 *   5. A `crypto.randomUUID()`-generated `requestId` is created at the
 *      top of the request and passed to the runner.
 *   6. Audit action for the shadow row is exactly
 *      `grant-access-for-order.eligibility_shadow`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const HANDLER = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "functions",
  "grant-access-for-order",
  "index.ts",
);
const SRC = readFileSync(HANDLER, "utf8");

const SHADOW_BEGIN = SRC.indexOf("ELIG-C1-SHADOW");
const SHADOW_END = SRC.indexOf("END ELIG-C1-SHADOW");

describe("ELIG-C1R · handler shadow integration invariant", () => {
  it("shared runner is defined once and encapsulates the helper call", () => {
    const defMatches = SRC.match(/function\s+runGrantEligibilityShadow\s*\(/g) || [];
    expect(defMatches.length).toBe(1);
    // Helper is called exactly once in the file — inside the runner.
    const helperCalls = SRC.match(/evaluateGrantEligibility\s*\(/g) || [];
    expect(helperCalls.length).toBe(1);
  });

  it("standard flow shadow block is present, delimited, and calls the runner", () => {
    expect(SHADOW_BEGIN).toBeGreaterThan(0);
    expect(SHADOW_END).toBeGreaterThan(SHADOW_BEGIN);
    const block = SRC.slice(SHADOW_BEGIN, SHADOW_END);
    expect(block).toMatch(/runGrantEligibilityShadow\s*\(/);
    expect(block).toMatch(/stage:\s*['"]standard['"]/);
  });

  it("standard shadow block runs AFTER auth resolution and order lookup", () => {
    const idxResolve = SRC.search(/resolveGrantAccessCaller\s*\(/);
    const idxPolicy = SRC.search(/enforceBranchPolicy\s*\(/);
    const idxOrderLookup = SRC.search(/\.from\(\s*["']orders_v2["']\s*\)/);
    expect(idxResolve).toBeGreaterThan(0);
    expect(idxPolicy).toBeGreaterThan(0);
    expect(idxOrderLookup).toBeGreaterThan(0);
    expect(idxResolve).toBeLessThan(SHADOW_BEGIN);
    expect(idxPolicy).toBeLessThan(SHADOW_BEGIN);
    expect(idxOrderLookup).toBeLessThan(SHADOW_BEGIN);
  });

  it("3ds_finalize branch runs the shadow BEFORE handleThreeDsFinalize (ELIG-C1R correction #3)", () => {
    const threeDsBranch = SRC.indexOf("_body.context === '3ds_finalize'");
    expect(threeDsBranch).toBeGreaterThan(0);
    // Find first runner call after the branch guard.
    const branchTail = SRC.slice(threeDsBranch);
    const runnerRel = branchTail.search(/runGrantEligibilityShadow\s*\(/);
    const writerRel = branchTail.search(/handleThreeDsFinalize\s*\(/);
    expect(runnerRel).toBeGreaterThan(0);
    expect(writerRel).toBeGreaterThan(0);
    expect(runnerRel).toBeLessThan(writerRel);
    // And the stage marker for 3DS is present.
    expect(SRC).toMatch(/stage:\s*['"]3ds_finalize_pre_writer['"]/);
  });

  it("standard shadow block does not perform a blocking return", () => {
    const block = SRC.slice(SHADOW_BEGIN, SHADOW_END);
    expect(block).not.toMatch(/return\s+new\s+Response\s*\(/);
    expect(block).not.toMatch(/from\(\s*["']orders_v2["']\s*\)\s*\.update\(/);
    expect(block).not.toMatch(/from\(\s*["']orders_v2["']\s*\)\s*\.upsert\(/);
    expect(block).not.toMatch(/from\(\s*["']orders_v2["']\s*\)\s*\.insert\(/);
  });

  it("server-generated request_id is created and threaded into the runner (ELIG-C1R correction #6)", () => {
    expect(SRC).toMatch(/const\s+requestId\s*=\s*crypto\.randomUUID\s*\(\s*\)/);
    // Both shadow invocations pass requestId.
    const runnerCalls = [...SRC.matchAll(/runGrantEligibilityShadow\s*\(\s*\{[\s\S]*?\}\s*\)/g)];
    expect(runnerCalls.length).toBeGreaterThanOrEqual(2);
    for (const m of runnerCalls) {
      expect(m[0]).toMatch(/\brequestId\s*[,\n}]/);
    }
  });

  it("audit action is exactly grant-access-for-order.eligibility_shadow", () => {
    expect(SRC).toMatch(/action:\s*['"]grant-access-for-order\.eligibility_shadow['"]/);
  });

  it("runner probes both entitlements AND subscriptions_v2 (ELIG-C1R correction #5)", () => {
    // Search inside the runner body — bounded by the marker `END ELIG-C1R shared runner`.
    const runnerBegin = SRC.indexOf("function runGrantEligibilityShadow");
    const runnerEnd = SRC.indexOf("END ELIG-C1R shared runner");
    expect(runnerBegin).toBeGreaterThan(0);
    expect(runnerEnd).toBeGreaterThan(runnerBegin);
    const runnerSrc = SRC.slice(runnerBegin, runnerEnd);
    expect(runnerSrc).toMatch(/\.from\(\s*['"]entitlements['"]\s*\)/);
    expect(runnerSrc).toMatch(/\.from\(\s*['"]subscriptions_v2['"]\s*\)/);
    // Both existence probes use limit(1), NOT maybeSingle (ELIG-C1R correction #5).
    expect(runnerSrc).not.toMatch(/\.maybeSingle\(\s*\)/);
    expect(runnerSrc).toMatch(/\.limit\(\s*1\s*\)/);
  });

  it("payments_v2 loader MUST NOT use .limit(1) (ELIG-C1R.1 — see all related payments)", () => {
    // Isolate the payments_v2 query inside the runner.
    const runnerBegin = SRC.indexOf("function runGrantEligibilityShadow");
    const runnerEnd = SRC.indexOf("END ELIG-C1R shared runner");
    const runnerSrc = SRC.slice(runnerBegin, runnerEnd);

    // Locate the payments_v2 query builder chain.
    const paymentsIdx = runnerSrc.indexOf(".from('payments_v2')");
    const paymentsIdxAlt = runnerSrc.indexOf('.from("payments_v2")');
    const start = paymentsIdx >= 0 ? paymentsIdx : paymentsIdxAlt;
    expect(start).toBeGreaterThanOrEqual(0);

    // The payments_v2 chain terminates at the first blank line or `;` at
    // statement boundary. Bound it to the next `const ` / `;` after start.
    const tail = runnerSrc.slice(start);
    const chainEnd = tail.search(/;\s*\n/);
    const paymentsChain = chainEnd > 0 ? tail.slice(0, chainEnd) : tail.slice(0, 400);

    // Guard: must filter by order_id.
    expect(paymentsChain).toMatch(/\.eq\(\s*['"]order_id['"]\s*,/);
    // Blocker under ELIG-C1R.1: no `.limit(...)` on the payments_v2 chain.
    expect(paymentsChain).not.toMatch(/\.limit\(/);
    // And no `.maybeSingle()` / `.single()` truncation either.
    expect(paymentsChain).not.toMatch(/\.maybeSingle\(\s*\)/);
    expect(paymentsChain).not.toMatch(/\.single\(\s*\)/);
  });

  it("runner classifies load-failure flags (ELIG-C1R correction #4)", () => {
    const runnerBegin = SRC.indexOf("function runGrantEligibilityShadow");
    const runnerEnd = SRC.indexOf("END ELIG-C1R shared runner");
    const runnerSrc = SRC.slice(runnerBegin, runnerEnd);
    expect(runnerSrc).toMatch(/paymentsLoadFailed/);
    expect(runnerSrc).toMatch(/entitlementLoadFailed/);
    expect(runnerSrc).toMatch(/subscriptionLoadFailed/);
  });

  it("payments rows flow to the helper unfiltered (ELIG-C1R.1 — no [0]/slice/filter truncation)", () => {
    const runnerBegin = SRC.indexOf("function runGrantEligibilityShadow");
    const runnerEnd = SRC.indexOf("END ELIG-C1R shared runner");
    const runnerSrc = SRC.slice(runnerBegin, runnerEnd);

    // Payment rows are captured into shadowPayments = ...data || []
    expect(runnerSrc).toMatch(/shadowPayments\s*=\s*[^;]*data[^;]*\|\|\s*\[\s*\]/);
    // shadowPayments is passed as `payments:` to the helper without indexing/slicing.
    expect(runnerSrc).toMatch(/payments:\s*shadowPayments\b/);
    // Sanity: nowhere in the runner is `shadowPayments` truncated.
    expect(runnerSrc).not.toMatch(/shadowPayments\s*\[\s*0\s*\]/);
    expect(runnerSrc).not.toMatch(/shadowPayments\.slice\(/);

  it("handler imports the pure helper from _shared, not a local copy", () => {
    expect(SRC).toMatch(/from\s+['"]\.\.\/_shared\/grant-eligibility\.ts['"]/);
  });
});
