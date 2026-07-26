import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

describe("legacy consultation URL", () => {
  it("redirects /cons to the public consultation page before slug resolution", () => {
    const redirect = '<Route path="/cons" element={<Navigate to="/consultation" replace />} />';

    expect(appSource).toContain(redirect);
    expect(appSource.indexOf(redirect)).toBeLessThan(
      appSource.indexOf('<Route path="/:slug" element={<LazyRoute><SitePageBySlug /></LazyRoute>} />'),
    );
  });
});
