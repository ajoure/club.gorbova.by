import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Edge Function integration contracts", () => {
  it("keeps every literal invocation backed by a checked-in function", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/verify-edge-function-contracts.mjs"],
        { cwd: process.cwd(), stdio: "pipe" },
      )
    ).not.toThrow();
  });

  it("uses canonical RBAC role codes for Telegram access revocation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/telegram-revoke-access/index.ts"),
      "utf8",
    );

    expect(source).toContain("has_role_v2");
    expect(source).toContain("_role_code: 'super_admin'");
    expect(source).not.toContain("_role: 'superadmin'");
  });

  it("protects GetCourse grant writes with service-or-user RBAC", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/getcourse-grant-access/index.ts"),
      "utf8",
    );

    expect(source).toContain("requestHasServiceRoleKey");
    expect(source).toContain("_section_code: 'payments'");
    expect(source).toContain("_section_code: 'integrations'");
    expect(source).toContain("_role_code: 'super_admin'");
  });

  it("keeps the production health audit read-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/system-health-full-check/index.ts"),
      "utf8",
    );

    expect(source).toContain('method: "OPTIONS"');
    expect(source).not.toContain('JSON.stringify({ ping: true })');
    expect(source).toContain('"authorization", "content-type", "apikey", "x-client-info"');
  });

  it("revokes Telegram only through the canonical guarded route after order deletion", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/hooks/useDealsBulkDelete.ts"),
      "utf8",
    );

    const deleteOrderAt = source.indexOf('.from("orders_v2")\n        .delete()');
    const revokeAt = source.indexOf('"telegram-revoke-access"');
    expect(deleteOrderAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeGreaterThan(deleteOrderAt);
    expect(source).toContain("respect_remaining_access: true");
    expect(source).not.toContain(["functions", 'invoke("telegram-club-access"'].join("."));
    expect(source).not.toContain(
      ["functions", 'invoke("send-access-revoked-notification"'].join("."),
    );
  });

  it("routes lesson broadcasts to the canonical permission-checked sender", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/admin/trainings/ContentCreationWizard.tsx"),
      "utf8",
    );

    expect(source).toContain('"telegram-mass-broadcast"');
    expect(source).toContain("bot_ids: [wizardData.notification.botId]");
    expect(source).toContain("wizardData.tariffIds.length === 0");
    expect(source).toContain("include: [{ tariff_ids: wizardData.tariffIds }]");
    expect(source).not.toContain("tariffIds: wizardData.tariffIds");
    expect(source).not.toContain(["/functions/v1", "telegram-broadcast"].join("/"));
  });

  it("keeps repaired GetCourse routes in the managed deployment registry", () => {
    const registry = readFileSync(
      resolve(process.cwd(), "supabase/functions.registry.txt"),
      "utf8",
    );

    expect(registry).toMatch(/^getcourse-grant-access$/m);
    expect(registry).toMatch(/^test-getcourse-sync$/m);
  });

  it("keeps the GetCourse compatibility route order-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/test-getcourse-sync/index.ts"),
      "utf8",
    );

    expect(source).toContain("direct GetCourse test mode is disabled");
    expect(source).toContain("/functions/v1/getcourse-grant-access");
    expect(source).toContain("if (authorization) headers.Authorization = authorization");
    expect(source).toContain("if (apiKey) headers.apikey = apiKey");
  });
});
