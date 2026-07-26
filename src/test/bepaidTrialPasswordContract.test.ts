import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/bepaid-create-token/index.ts"),
  "utf8",
);

describe("bepaid-create-token trial password contract", () => {
  it("uses the password chosen in checkout and never persists or returns it", () => {
    expect(source).toContain("newUserPassword = customerPassword || generatePassword()");
    expect(source).toContain("customerPassword.length < 6");
    expect(source).not.toContain("new_user_password");
    expect(source).not.toContain("newUserPassword: newUserCreated");
  });
});
