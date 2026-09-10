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

  it.each(['integration-sync', 'getcourse-sync', 'amocrm-sync', 'telegram-bot-rights-check'])(
    '%s checks the shared owner boundary before reading input', name => {
      const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
      const guard = source.indexOf('await integrationOwnerDenial(');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(source.indexOf('await req.json()'));
      expect(source).toContain('status: denial.status');
    },
  );
  it.each(['manychat-discover-pages', 'instagram-webhook-test', 'hosterby-api'])(
    '%s uses the canonical owner before configuration input', name => {
      const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
      expect(source.indexOf('has_role_v2')).toBeLessThan(source.indexOf('await req.json()'));
      expect(source).toMatch(/_role_code:\s*['"]super_admin['"]/);
      expect(source).toContain('isSuperAdmin !== true');
    },
  );
  it('keeps Kinescope operations separate from credential validation', () => {
    const source = readFileSync('supabase/functions/kinescope-api/index.ts', 'utf8');
    expect(source).toContain('(action === "validate_token" || directToken) && !isConnectionOwner');
    expect(source.indexOf('!isConnectionOwner')).toBeLessThan(source.indexOf('let apiToken = directToken'));
  });
});
