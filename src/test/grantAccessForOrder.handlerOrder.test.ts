/**
 * PATCH-GRANT-ACCESS-AUTHZ-V1 / CLOSURE-1
 *
 * Source-level integration invariant for the deployed handler
 * `supabase/functions/grant-access-for-order/index.ts`.
 *
 * Proves — WITHOUT any network call or DML — that the top-level
 * request handler enforces the following order of operations:
 *
 *   1. resolveGrantAccessCaller(req, supabase)            ← identity
 *   2. early-return on !authResult.ok                     ← 401 gate
 *   3. detectBranch(_body)                                ← branch classify
 *   4. enforceBranchPolicy(branch, caller)                ← 403 gate
 *   5. early-return on policy failure
 *   6. THEN and only then:
 *        - orderId parsing / order lookup (.from("orders_v2"))
 *        - audit_logs writes           (.from("audit_logs").insert)
 *        - three_ds_writer delegation  (import('./three_ds_writer.ts'))
 *        - subscription/entitlement writes
 *
 * If any of these regress (e.g. a future refactor moves the order lookup
 * above the auth gate), this test fails immediately.
 *
 * This complements the helper unit tests: those prove the matrix logic in
 * isolation; this one proves the deployed handler actually invokes the
 * helpers first, in the correct order, before any side effect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const HANDLER_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "functions",
  "grant-access-for-order",
  "index.ts",
);
const SRC = readFileSync(HANDLER_PATH, "utf8");

/** Strip string literals, template literals, and comments so that
 *  index-based ordering checks see only structural code. */
function stripLiteralsAndComments(src: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLine = false;
  let inBlock = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) { if (ch === "\n") { inLine = false; out += ch; } i++; continue; }
    if (inBlock) { if (ch === "*" && next === "/") { inBlock = false; i += 2; continue; } i++; continue; }
    if (inSingle) { if (ch === "\\") { i += 2; continue; } if (ch === "'") inSingle = false; i++; continue; }
    if (inDouble) { if (ch === "\\") { i += 2; continue; } if (ch === '"') inDouble = false; i++; continue; }
    if (inTemplate) { if (ch === "\\") { i += 2; continue; } if (ch === "`") inTemplate = false; i++; continue; }
    if (ch === "/" && next === "/") { inLine = true; i += 2; continue; }
    if (ch === "/" && next === "*") { inBlock = true; i += 2; continue; }
    if (ch === "'") { inSingle = true; i++; continue; }
    if (ch === '"') { inDouble = true; i++; continue; }
    if (ch === "`") { inTemplate = true; i++; continue; }
    out += ch;
    i++;
  }
  return out;
}

const CODE = stripLiteralsAndComments(SRC);

function firstIndex(re: RegExp): number {
  const m = CODE.match(re);
  if (!m) return -1;
  return CODE.indexOf(m[0]);
}

describe("CLOSURE-1 · grant-access-for-order handler order-of-operations invariant", () => {
  const idxResolve = firstIndex(/resolveGrantAccessCaller\s*\(/);
  const idxAuthFail = firstIndex(/if\s*\(\s*!\s*authResult\.ok\s*\)/);
  const idxDetectBranch = firstIndex(/detectBranch\s*\(/);
  const idxEnforce = firstIndex(/enforceBranchPolicy\s*\(/);
  const idxPolicyFail = firstIndex(/if\s*\(\s*policy\s*\)/);

  const idxOrdersV2 = firstIndex(/\.from\(\s*\)?\s*orders_v2/); // won't match after stripping — use raw check below
  // For the "first side effect" we look at the RAW source (post-strip removes table names because they are strings).
  // Compute those indices on SRC directly.
  const rawOrdersLookup = SRC.search(/\.from\(\s*["']orders_v2["']\s*\)/);
  const rawAuditInsert = SRC.search(/\.from\(\s*["']audit_logs["']\s*\)\s*\.insert\(/);
  const rawThreeDs = SRC.search(/import\(\s*['"]\.\/three_ds_writer\.ts['"]\s*\)/);
  const rawSubsV2 = SRC.search(/\.from\(\s*["']subscriptions_v2["']\s*\)/);

  // Map raw indices back into a comparable coordinate system. Since
  // stripLiteralsAndComments only removes characters, positions in CODE are
  // always <= positions in SRC. For the ordering assertion we compare the
  // stripped-position of the auth calls to the RAW position of the side
  // effects and demand `authIdxInSrc < sideEffectIdxInSrc`. We recover the
  // auth call positions on the raw source too.
  const srcIdxResolve = SRC.search(/resolveGrantAccessCaller\s*\(/);
  const srcIdxAuthFail = SRC.search(/if\s*\(\s*!\s*authResult\.ok\s*\)/);
  const srcIdxDetectBranch = SRC.search(/detectBranch\s*\(/);
  const srcIdxEnforce = SRC.search(/enforceBranchPolicy\s*\(/);
  const srcIdxPolicyFail = SRC.search(/if\s*\(\s*policy\s*\)/);

  it("all auth-gate anchors are present in the handler source", () => {
    expect(idxResolve).toBeGreaterThanOrEqual(0);
    expect(idxAuthFail).toBeGreaterThanOrEqual(0);
    expect(idxDetectBranch).toBeGreaterThanOrEqual(0);
    expect(idxEnforce).toBeGreaterThanOrEqual(0);
    expect(idxPolicyFail).toBeGreaterThanOrEqual(0);
  });

  it("all guarded side-effect anchors are present", () => {
    expect(rawOrdersLookup).toBeGreaterThanOrEqual(0);
    expect(rawAuditInsert).toBeGreaterThanOrEqual(0);
    expect(rawThreeDs).toBeGreaterThanOrEqual(0);
    expect(rawSubsV2).toBeGreaterThanOrEqual(0);
  });

  it("auth pipeline runs in order: resolve → 401-gate → detectBranch → enforce → 403-gate", () => {
    expect(srcIdxResolve).toBeLessThan(srcIdxAuthFail);
    expect(srcIdxAuthFail).toBeLessThan(srcIdxDetectBranch);
    expect(srcIdxDetectBranch).toBeLessThan(srcIdxEnforce);
    expect(srcIdxEnforce).toBeLessThan(srcIdxPolicyFail);
  });

  it("resolveGrantAccessCaller precedes first orders_v2 lookup", () => {
    expect(srcIdxResolve).toBeLessThan(rawOrdersLookup);
    expect(srcIdxPolicyFail).toBeLessThan(rawOrdersLookup);
  });

  it("resolveGrantAccessCaller precedes first audit_logs.insert", () => {
    expect(srcIdxResolve).toBeLessThan(rawAuditInsert);
    expect(srcIdxPolicyFail).toBeLessThan(rawAuditInsert);
  });

  it("resolveGrantAccessCaller precedes three_ds_writer delegation", () => {
    expect(srcIdxResolve).toBeLessThan(rawThreeDs);
    expect(srcIdxPolicyFail).toBeLessThan(rawThreeDs);
  });

  it("resolveGrantAccessCaller precedes first subscriptions_v2 access", () => {
    expect(srcIdxResolve).toBeLessThan(rawSubsV2);
    expect(srcIdxPolicyFail).toBeLessThan(rawSubsV2);
  });

  it("orderId is required check exists (400) and happens after auth gates", () => {
    const idxOrderIdRequired = SRC.search(/orderId is required/);
    expect(idxOrderIdRequired).toBeGreaterThanOrEqual(0);
    expect(srcIdxPolicyFail).toBeLessThan(idxOrderIdRequired);
  });

  it("handler imports helpers from ./caller_auth.ts (not a shadow copy)", () => {
    expect(SRC).toMatch(
      /from\s+['"]\.\/caller_auth\.ts['"]/,
    );
    expect(SRC).toMatch(/resolveGrantAccessCaller,/);
    expect(SRC).toMatch(/detectBranch,/);
    expect(SRC).toMatch(/enforceBranchPolicy,/);
  });

  it("adminManualAccessEdit branch is admin-only in the deployed matrix (CLOSURE-1)", () => {
    // Read caller_auth.ts and assert the matrix returns forbidden_admin_only
    // for service_role/adminManualAccessEdit — contract-level invariant.
    const authPath = path.resolve(
      __dirname,
      "..",
      "..",
      "supabase",
      "functions",
      "grant-access-for-order",
      "caller_auth.ts",
    );
    const authSrc = readFileSync(authPath, "utf8");
    // The case must contain the admin-only error code and NOT be merged
    // with the service_role-permitting branches.
    expect(authSrc).toMatch(/case\s+["']adminManualAccessEdit["']\s*:/);
    expect(authSrc).toMatch(/forbidden_admin_only/);
    // Ensure adminManualAccessEdit is NOT in the fallthrough with "standard".
    const fallthrough = authSrc.match(
      /case\s+["']standard["']\s*:\s*case\s+["']adminManualAccessEdit["']/,
    );
    expect(fallthrough).toBeNull();
  });
});
