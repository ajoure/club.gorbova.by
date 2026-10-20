import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("supabase/config.toml", "utf8");
const sender = readFileSync("supabase/functions/send-email/index.ts", "utf8");
const rolesAdmin = readFileSync("supabase/functions/roles-admin/index.ts", "utf8");
const usersAdminActions = readFileSync(
  "supabase/functions/users-admin-actions/index.ts",
  "utf8",
);

describe("send-email authentication boundary", () => {
  it("uses the application auth gate for opaque managed keys before any account or SMTP work", () => {
    expect(config).toMatch(/\[functions\.send-email\]\s+verify_jwt\s*=\s*false/);
    expect(sender).toContain("await authorizeEmailSender(req, supabaseKey");
    const denied = sender.indexOf("if (!decision.allowed)");
    expect(denied).toBeGreaterThan(0);
    expect(sender.indexOf("const body = await req.json()")).toBeGreaterThan(denied);
    expect(sender.indexOf("const account = await getEmailAccount")).toBeGreaterThan(denied);
  });

  it("retains live verified staff RBAC and supports a no-send transport diagnostic", () => {
    expect(sender).toContain("userClient.auth.getClaims(bearer)");
    expect(sender).toContain('"has_admin_section_access"');
    expect(sender).toContain('_section_code: "communication"');
    expect(sender).toContain('_min_level: "manage"');
    expect(sender).toContain('"has_role_v2", { _user_id: actorId, _role_code: "admin" }');
    expect(sender).toContain('"has_role_v2", { _user_id: actorId, _role_code: "super_admin" }');
    expect(sender).toContain('checks.every(result => !result.error)');
    expect(sender).toContain("authorized_as: decision.kind, sent: false");
    expect(sender.indexOf("body.action === 'diagnose'")).toBeLessThan(sender.indexOf("const account = await getEmailAccount"));
  });

  it("uses the service credential for internal administrative senders", () => {
    expect(rolesAdmin).toContain(
      '"Authorization": `Bearer ${serviceRoleKey}`',
    );
    expect(usersAdminActions).toContain(
      '"Authorization": `Bearer ${supabaseServiceKey}`',
    );
    expect(usersAdminActions).not.toContain(
      '"Authorization": `Bearer ${supabaseAnonKey}`',
    );
  });
});
