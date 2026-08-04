import { describe, expect, it } from "vitest";
import {
  getAccessAliasHostname,
  getAccessAwareUrl,
  getCanonicalHostname,
  isAccessAliasHostname,
  isProxyEligibleGorbovaHostname,
} from "./accessAlias";

describe("access alias host mapping", () => {
  it.each([
    ["a.gorbova.by", "gorbova.by"],
    ["a.club.gorbova.by", "club.gorbova.by"],
    ["a.calendar.club.gorbova.by", "calendar.club.gorbova.by"],
  ])("maps %s to %s", (alias, canonical) => {
    expect(getCanonicalHostname(alias)).toBe(canonical);
    expect(getAccessAliasHostname(canonical)).toBe(alias);
    expect(isAccessAliasHostname(alias)).toBe(true);
  });

  it("does not mirror infrastructure or foreign hosts", () => {
    expect(isProxyEligibleGorbovaHostname("pdf.gorbova.by")).toBe(false);
    expect(isProxyEligibleGorbovaHostname("access.gorbova.by")).toBe(false);
    expect(isProxyEligibleGorbovaHostname("example.com")).toBe(false);
    expect(getCanonicalHostname("a.example.com")).toBe("a.example.com");
    expect(getCanonicalHostname("a.a.club.gorbova.by")).toBe("a.a.club.gorbova.by");
    expect(isProxyEligibleGorbovaHostname("a.club.gorbova.by")).toBe(false);
  });
});

describe("access-aware navigation", () => {
  const currentAlias = "a.club.gorbova.by";

  it("rewrites absolute links to every eligible gorbova.by host", () => {
    expect(getAccessAwareUrl("https://gorbova.by/pay/token?x=1#ok", currentAlias))
      .toBe("https://a.gorbova.by/pay/token?x=1#ok");
    expect(getAccessAwareUrl("https://cb.gorbova.by/course", currentAlias))
      .toBe("https://a.cb.gorbova.by/course");
  });

  it("keeps relative, external and infrastructure URLs unchanged", () => {
    expect(getAccessAwareUrl("/purchases", currentAlias)).toBe("/purchases");
    expect(getAccessAwareUrl("https://checkout.bepaid.by/pay", currentAlias))
      .toBe("https://checkout.bepaid.by/pay");
    expect(getAccessAwareUrl("https://pdf.gorbova.by/file", currentAlias))
      .toBe("https://pdf.gorbova.by/file");
  });

  it("does not rewrite canonical sessions", () => {
    expect(getAccessAwareUrl("https://club.gorbova.by/auth", "club.gorbova.by"))
      .toBe("https://club.gorbova.by/auth");
  });

  it("never grows a malformed double alias", () => {
    expect(getAccessAwareUrl("https://a.a.club.gorbova.by/auth", currentAlias))
      .toBe("https://a.a.club.gorbova.by/auth");
  });
});
