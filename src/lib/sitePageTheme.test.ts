import { describe, expect, it } from "vitest";
import { sitePageTheme } from "./sitePageTheme";

describe("page-local brand theme", () => {
  it("keeps existing pages unchanged until the preset is selected", () => {
    expect(sitePageTheme({ primary_color: "#e422c2", font_family: "Arial" })).toEqual({ className: "site-page", style: { fontFamily: "Arial" } });
  });
  it("applies the configured color with readable button text only inside the selected page", () => {
    const theme = sitePageTheme({ preset: "gorbova", primary_color: "#e422c2" });
    expect(theme.className).toContain("site-page--gorbova");
    expect(theme.style["--primary"]).toBe("310.52 78.23% 51.37%");
    expect(theme.style["--primary-foreground"]).toBe("0 0% 0%");
  });
  it("falls back to the charcoal brand button for an invalid color", () => {
    expect(sitePageTheme({ preset: "gorbova", primary_color: "url(untrusted)" }).style["--primary-foreground"]).toBe("0 0% 100%");
  });
});
