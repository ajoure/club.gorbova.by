/**
 * B0a-UI (PATCH-PAYMENTS-MANAGEMENT-V2) — split-proof static invariant test.
 *
 * Seat of truth: `ContactDetailSheet.handleGrantNewAccess`.
 *
 * Invariants proved here (test-only, no runtime code changed):
 *   1. handler contains exactly ONE `.from("orders_v2").insert(...)` call
 *   2. handler contains ZERO `.from("payments_v2").insert(...)` calls
 *      → admin_grant / admin_deal_only never create a payments_v2 row
 *   3. `meta.source` distinguishes the two modes (`admin_grant` / `admin_deal_only`)
 *   4. `meta.deal_only` is bound to `createDealOnly`
 *   5. `grant-access-for-order` invocation is gated behind
 *      `if (!createDealOnly && !isGhostContact)` — never runs in deal-only mode
 *
 * If any of these regress, this test fails immediately without needing a
 * production route, credentials, or database.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH = path.resolve(
  __dirname,
  "ContactDetailSheet.tsx"
);
const SRC = readFileSync(SOURCE_PATH, "utf8");

/** Extract the body of `const handleGrantNewAccess = async () => { ... };` */
function extractHandleGrantNewAccess(src: string): string {
  const marker = "const handleGrantNewAccess = async () =>";
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error("handleGrantNewAccess not found in ContactDetailSheet.tsx");
  }
  // Find opening `{` of the arrow function body
  const openIdx = src.indexOf("{", start);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting handleGrantNewAccess");
}

const HANDLER_BODY = extractHandleGrantNewAccess(SRC);

/** Count non-overlapping matches of a regex in a string. */
function countMatches(body: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return (body.match(g) || []).length;
}

describe("B0a-UI · ContactDetailSheet.handleGrantNewAccess — payments_v2 firewall", () => {
  it("handler is extractable and non-empty", () => {
    expect(HANDLER_BODY.length).toBeGreaterThan(500);
    expect(HANDLER_BODY.startsWith("{")).toBe(true);
    expect(HANDLER_BODY.endsWith("}")).toBe(true);
  });

  it("creates exactly ONE orders_v2 row (single .from(\"orders_v2\").insert(...))", () => {
    // .from("orders_v2") followed (within the handler) by .insert(
    const ordersInsert = countMatches(
      HANDLER_BODY,
      /\.from\(\s*["']orders_v2["']\s*\)\s*\.insert\(/
    );
    expect(ordersInsert).toBe(1);
  });

  it("NEVER inserts into payments_v2 — .from(\"payments_v2\").insert(...) count = 0", () => {
    const paymentsInsert = countMatches(
      HANDLER_BODY,
      /\.from\(\s*["']payments_v2["']\s*\)\s*\.insert\(/
    );
    expect(paymentsInsert).toBe(0);
  });

  it("does not reference the payments_v2 table for any write op inside the handler", () => {
    // Allow only comments mentioning payments_v2; disallow any `.from("payments_v2")` chain.
    // Strip line and block comments before scanning.
    const stripped = HANDLER_BODY
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const anyPaymentsV2 = countMatches(
      stripped,
      /\.from\(\s*["']payments_v2["']\s*\)/
    );
    expect(anyPaymentsV2).toBe(0);
  });

  it("meta.source encodes both modes via ternary on createDealOnly", () => {
    // source: createDealOnly ? "admin_deal_only" : "admin_grant"
    expect(HANDLER_BODY).toMatch(
      /source:\s*createDealOnly\s*\?\s*["']admin_deal_only["']\s*:\s*["']admin_grant["']/
    );
  });

  it("meta.deal_only is bound to createDealOnly (not hard-coded)", () => {
    expect(HANDLER_BODY).toMatch(/deal_only:\s*createDealOnly\b/);
  });

  it("canonical grant-access-for-order is called ONLY inside `if (!createDealOnly && !isGhostContact)`", () => {
    const guardIdx = HANDLER_BODY.search(
      /if\s*\(\s*!\s*createDealOnly\s*&&\s*!\s*isGhostContact\s*\)/
    );
    expect(guardIdx).toBeGreaterThan(-1);

    const invokeRe = /supabase\.functions\.invoke\(\s*["']grant-access-for-order["']/g;
    // Every invoke of grant-access-for-order in the handler must appear AFTER the guard.
    let m: RegExpExecArray | null;
    let invocations = 0;
    while ((m = invokeRe.exec(HANDLER_BODY)) !== null) {
      invocations++;
      expect(m.index).toBeGreaterThan(guardIdx);
    }
    // Exactly one canonical fulfillment call in the handler.
    expect(invocations).toBe(1);
  });

  it("passes `source: \"admin_grant\"` (not \"admin_deal_only\") to grant-access-for-order body", () => {
    // The canonical grant is only ever invoked in the grant branch, so source is admin_grant.
    const invokeBlock = HANDLER_BODY.slice(
      HANDLER_BODY.indexOf("grant-access-for-order")
    );
    expect(invokeBlock).toMatch(/source:\s*["']admin_grant["']/);
    expect(invokeBlock).not.toMatch(/source:\s*["']admin_deal_only["']/);
  });

  it("final_price / paid_amount / base_price are 0 on the orders_v2 payload (non-financial grant)", () => {
    expect(HANDLER_BODY).toMatch(/base_price:\s*0\b/);
    expect(HANDLER_BODY).toMatch(/final_price:\s*0\b/);
    expect(HANDLER_BODY).toMatch(/paid_amount:\s*0\b/);
  });
});
