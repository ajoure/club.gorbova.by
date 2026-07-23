import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "functions",
  "qa-moderation-runtime-proof",
  "index.ts",
), "utf8");

describe("qa-moderation-runtime-proof security guard", () => {
  it("keeps the QA password out of source and reads it only from function secrets", () => {
    expect(source).not.toContain("QaUser!2026");
    expect(source).toContain('Deno.env.get("QA_MODERATION_PROOF_PASSWORD")');
  });

  it("requires verified super-admin identity and an enabled kill-switch before writes", () => {
    const claimsIndex = source.indexOf("userClient.auth.getClaims(token)");
    const roleIndex = source.indexOf('admin.rpc("has_role_v2"');
    const killSwitchIndex = source.indexOf('"qa_test_helper_enabled"');
    const writeIndex = source.indexOf('.from("live_event_room_moderation")');

    expect(claimsIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(claimsIndex);
    expect(killSwitchIndex).toBeGreaterThan(roleIndex);
    expect(writeIndex).toBeGreaterThan(killSwitchIndex);
    expect(source).toContain("created_by: callerId");
  });
});
