/**
 * PATCH-GRANT-ACCESS-ELIGIBILITY-V1 / ELIG-C1-SHADOW
 *
 * Source-level invariant that the handler wires the shadow evaluation
 * WITHOUT enabling enforcement:
 *
 *   authz  → order lookup / evidence load → shadow evaluation → grant flow
 *
 * MUST be true:
 *   1. Shadow evaluation runs AFTER auth policy check AND after order
 *      lookup (order is loaded before shadow evidence).
 *   2. `evaluateGrantEligibility` return value is NEVER used in a
 *      blocking response — no `return new Response(... shadow.would_allow ...)`
 *      pattern, no `if (shadow.would_allow === false) return`, etc.
 *   3. No orders_v2 UPDATE happens as part of the shadow block.
 *   4. The audit action used for shadow logging is exactly
 *      `grant-access-for-order.eligibility_shadow`.
 *   5. The shadow block is wrapped in try/catch (never throws upward).
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

// Locate the shadow block by its dedicated marker.
const SHADOW_BEGIN = SRC.indexOf("ELIG-C1-SHADOW");
const SHADOW_END = SRC.indexOf("END ELIG-C1-SHADOW");

describe("ELIG-C1 · handler shadow integration invariant", () => {
  it("shadow block is present and delimited by BEGIN/END markers", () => {
    expect(SHADOW_BEGIN).toBeGreaterThan(0);
    expect(SHADOW_END).toBeGreaterThan(SHADOW_BEGIN);
  });

  it("shadow block runs AFTER auth resolution and order lookup", () => {
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

  it("shadow block is wrapped in try/catch", () => {
    const block = SRC.slice(SHADOW_BEGIN, SHADOW_END);
    expect(block).toMatch(/try\s*\{/);
    expect(block).toMatch(/catch\s*\(/);
  });

  it("shadow block calls evaluateGrantEligibility exactly once", () => {
    const block = SRC.slice(SHADOW_BEGIN, SHADOW_END);
    const matches = block.match(/evaluateGrantEligibility\s*\(/g) || [];
    expect(matches.length).toBe(1);
  });

  it("shadow verdict is NEVER used in a blocking return", () => {
    // Scan the whole file: `shadow.would_allow` must not appear inside any
    // `return` expression or as a guard for a `return new Response`.
    // We assert that `shadow.would_allow` appears only inside the shadow
    // block (console.log / audit payload) and never in a return.
    const shadowRefs = [...SRC.matchAll(/shadow\.would_allow/g)];
    for (const m of shadowRefs) {
      const idx = m.index || 0;
      expect(idx).toBeGreaterThanOrEqual(SHADOW_BEGIN);
      expect(idx).toBeLessThan(SHADOW_END);
    }
    const shadowReasonRefs = [...SRC.matchAll(/shadow\.reason/g)];
    for (const m of shadowReasonRefs) {
      const idx = m.index || 0;
      expect(idx).toBeGreaterThanOrEqual(SHADOW_BEGIN);
      expect(idx).toBeLessThan(SHADOW_END);
    }
  });

  it("shadow block does NOT contain any orders_v2 update/insert/upsert", () => {
    const block = SRC.slice(SHADOW_BEGIN, SHADOW_END);
    expect(block).not.toMatch(/from\(\s*["']orders_v2["']\s*\)\s*\.update\(/);
    expect(block).not.toMatch(/from\(\s*["']orders_v2["']\s*\)\s*\.upsert\(/);
    expect(block).not.toMatch(/from\(\s*["']orders_v2["']\s*\)\s*\.insert\(/);
    // Nor a raw `orders_v2` write via rpc.
    expect(block).not.toMatch(/rpc\(\s*["'][^"']*order[^"']*update[^"']*["']/i);
  });

  it("shadow block does NOT contain a blocking `return new Response`", () => {
    const block = SRC.slice(SHADOW_BEGIN, SHADOW_END);
    expect(block).not.toMatch(/return\s+new\s+Response\s*\(/);
  });

  it("audit action is exactly grant-access-for-order.eligibility_shadow", () => {
    const block = SRC.slice(SHADOW_BEGIN, SHADOW_END);
    expect(block).toMatch(/action:\s*['"]grant-access-for-order\.eligibility_shadow['"]/);
  });

  it("shadow block imports the pure helper from _shared, not a local shadow copy", () => {
    expect(SRC).toMatch(
      /from\s+['"]\.\.\/_shared\/grant-eligibility\.ts['"]/,
    );
    expect(SRC).toMatch(/evaluateGrantEligibility/);
  });
});
