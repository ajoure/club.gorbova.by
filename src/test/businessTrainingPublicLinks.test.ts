import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const libraryModule = readFileSync(resolve(process.cwd(), "src/pages/LibraryModule.tsx"), "utf8");
const renewalNotification = readFileSync(
  resolve(process.cwd(), "supabase/functions/buh-business-notify/index.ts"),
  "utf8",
);

describe("business training public links", () => {
  it("uses the canonical working host instead of the retired subdomain", () => {
    expect(libraryModule).toContain("https://gorbova.by/business-training");
    expect(renewalNotification).toContain("https://gorbova.by/purchases");
    expect(libraryModule).not.toContain("business-training.gorbova.by");
    expect(renewalNotification).not.toContain("business-training.gorbova.by");
  });
});
