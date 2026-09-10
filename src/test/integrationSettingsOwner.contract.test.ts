import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("integration credential operations require canonical super_admin", () => {
  it.each(["telegram-bot-actions", "integration-healthcheck", "email-test-connection"])(
    "%s checks the role before input, credentials or provider effects", (name) => {
      const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
      const roleCheck = source.indexOf("has_role_v2");
      expect(roleCheck).toBeGreaterThan(-1);
      expect(source).toMatch(/_role_code:\s*['"]super_admin['"]/);
      expect(roleCheck).toBeLessThan(source.indexOf("await req.json()"));
      expect(source).not.toContain("_permission_code: 'entitlements.manage'");
      expect(source).not.toContain('_role: "superadmin"');
      expect(source).toMatch(/(?:hasPermission|isSuperAdmin) !== true/);
      expect(source).toMatch(/status: 403/);
      expect(source).toContain(".auth.getUser(");
    },
  );
});
