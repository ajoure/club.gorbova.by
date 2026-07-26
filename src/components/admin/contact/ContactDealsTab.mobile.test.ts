import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/components/admin/contact/ContactDealsTab.tsx"),
  "utf8",
);

describe("ContactDealsTab mobile action row", () => {
  it("keeps deal actions on one non-wrapping row", () => {
    expect(source).toContain("flex-nowrap");
    expect(source).toContain("overflow-hidden");
  });

  it("does not expose receipt download in the compact deal list", () => {
    expect(source).not.toContain('title="Чек"');
    expect(source).not.toContain("<Download");
  });

  it("keeps the open chevron from shrinking or wrapping", () => {
    expect(source).toContain(
      '<ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />',
    );
  });
});
