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
  it("keeps the platform JWT check enabled", () => {
    expect(config).toMatch(/\[functions\.send-email\]\s+verify_jwt\s*=\s*true/);
  });

  it("permits only the service role or verified communication administrators", () => {
    expect(sender).toContain("if (bearer !== supabaseKey)");
    expect(sender).toContain("userClient.auth.getClaims(bearer)");
    expect(sender).toContain('"has_admin_section_access"');
    expect(sender).toContain('_section_code: "communication"');
    expect(sender).toContain('_min_level: "manage"');
    expect(sender).toContain('"has_role_v2", { _user_id: actorId, _role_code: "admin" }');
    expect(sender).toContain('"has_role_v2", { _user_id: actorId, _role_code: "super_admin" }');
    expect(sender).toContain("[send-email][auth] handler_enter");
    expect(sender).not.toContain("/auth/v1/user");
    expect(sender.indexOf("parsedRequest = await req.json()")).toBeGreaterThan(
      sender.indexOf("if (bearer !== supabaseKey)"),
    );
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
