import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/bepaid-create-token/index.ts"),
  "utf8",
);

describe("bepaid-create-token verified identity contract", () => {
  it("requires a verified JWT and never creates or confirms an arbitrary email", () => {
    expect(source).toContain("error: 'email_verification_required'");
    expect(source).toContain("emailLower !== authUserEmail");
    expect(source).toContain("const userId = authUserId");
    expect(source).not.toContain("email_confirm: true");
    expect(source).not.toContain("customerPassword");
    expect(source).not.toContain("auth.admin.createUser");
    expect(source).not.toContain("new_user_password");
  });
});
