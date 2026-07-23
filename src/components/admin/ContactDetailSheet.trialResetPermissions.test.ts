import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = fs.readFileSync(
  path.resolve(__dirname, "ContactDetailSheet.tsx"),
  "utf8",
);

const migrationSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../supabase/migrations/20260723094740_allow_contact_editors_reset_trial.sql",
  ),
  "utf8",
);

describe("contact trial reset permissions", () => {
  it("shows the action to staff who can edit contacts", () => {
    expect(componentSource).toContain(
      'canWrite("contacts") && trial.product_id',
    );
  });

  it("enforces the same permission in the database function", () => {
    expect(migrationSource).toContain(
      "public.has_admin_section_access(v_actor, 'contacts', 'edit')",
    );
    expect(migrationSource).toContain(
      "REVOKE ALL ON FUNCTION public.admin_reset_user_trial",
    );
  });
});
