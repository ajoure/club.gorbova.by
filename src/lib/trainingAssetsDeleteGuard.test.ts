import { describe, expect, it } from "vitest";
import source from "../../supabase/functions/training-assets-delete/index.ts?raw";

describe("training-assets-delete shared asset guard", () => {
  it("does not apply text operators directly to jsonb content", () => {
    expect(source).not.toContain("content->>url.ilike");
    expect(source).not.toContain('.or("content->>');
  });

  it("paginates deterministically and fails closed when the lookup errors", () => {
    expect(source).toContain('.select("id,content")');
    expect(source).toContain('.order("id", { ascending: true })');
    expect(source).toContain("throw new Error(`Shared asset lookup failed: ${error.message}`)");
  });
});
