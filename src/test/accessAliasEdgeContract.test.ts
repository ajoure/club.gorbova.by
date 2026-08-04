import { describe, expect, it } from "vitest";
import {
  expandWithAccessAliasOrigins,
  getAccessAliasOrigin,
  resolvePublicReturnOrigin,
} from "../../supabase/functions/_shared/access-alias-origin";

describe("edge access alias origin guard", () => {
  it.each([
    "https://a.gorbova.by",
    "https://a.club.gorbova.by",
    "https://a.calendar.club.gorbova.by",
  ])("accepts exact alternate origin %s", (origin) => {
    expect(getAccessAliasOrigin(origin)).toBe(origin);
    expect(resolvePublicReturnOrigin(origin)).toBe(origin);
  });

  it.each([
    "https://gorbova.by",
    "https://club.gorbova.by",
    "https://a.example.com",
    "https://a.pdf.gorbova.by",
    "http://a.gorbova.by",
    "https://gorbova.lovable.app",
    "https://a.a.club.gorbova.by",
    "https://a.club.gorbova.by:8443",
  ])("rejects non-alias origin %s", (origin) => {
    expect(getAccessAliasOrigin(origin)).toBeNull();
    expect(resolvePublicReturnOrigin(origin)).toBe("https://gorbova.by");
  });

  it("expands only eligible exact production origins", () => {
    const origins = expandWithAccessAliasOrigins([
      "https://gorbova.by",
      "https://club.gorbova.by",
      "https://gorbova.lovable.app",
    ]);
    expect(origins).toContain("https://a.gorbova.by");
    expect(origins).toContain("https://a.club.gorbova.by");
    expect(origins).not.toContain("https://a.gorbova.lovable.app");
  });
});
