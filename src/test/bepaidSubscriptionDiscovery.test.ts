import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repoRoot = `${process.cwd()}/`;

describe("bePaid subscription discovery regression guards", () => {
  it("does not silently stop the provider list at six pages", () => {
    const source = readFileSync(
      `${repoRoot}supabase/functions/bepaid-list-subscriptions/index.ts`,
      "utf8",
    );

    expect(source).toContain("maxPages: number = 100");
    expect(source).not.toContain("fetchListAllPages(authString, 6)");
    expect(source).toContain("api_list_complete: !apiListTruncated");
  });

  it("persists every provider list row, including complete rows", () => {
    const source = readFileSync(
      `${repoRoot}supabase/functions/bepaid-list-subscriptions/index.ts`,
      "utf8",
    );

    const persistLoop = source.slice(
      source.indexOf("for (const sub of apiItems)"),
      source.indexOf("// Merge API data with DB data"),
    );
    expect(persistLoop).toContain(".upsert(write");
    expect(persistLoop).toContain("provider_subscription_id: sub.id");
    expect(persistLoop).toContain("discovered_via");
  });

  it("surfaces structured Edge Function failures in the contact card", () => {
    const source = readFileSync(
      `${repoRoot}src/components/admin/ContactDetailSheet.tsx`,
      "utf8",
    );

    expect(source).toContain("data?.success === false || data?.ok === false || data?.error");
    expect(source).toContain('ilike("raw_data->customer->>email", normalizedEmail)');
  });
});
