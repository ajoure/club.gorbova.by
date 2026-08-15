import { describe, expect, it } from "vitest";
import {
  resolveInstagramAccountDisplayName,
  resolveInstagramSourceLabel,
} from "./resolveInstagramSourceLabel";

describe("resolveInstagramSourceLabel", () => {
  it("prefers a configured human-readable display name", () => {
    expect(
      resolveInstagramAccountDisplayName({
        display_name: "Бухгалтер-миллионер",
        account_name: "legacy-name",
        instagram_page_id: "123456789",
      }),
    ).toBe("Бухгалтер-миллионер");
  });

  it.each(["mc:305d6fa43ef5c6f8", "@mc:305d6fa43ef5c6f8", "subscriber_id", "thread_key"])(
    "never exposes the synthetic identifier %s",
    (accountName) => {
      expect(
        resolveInstagramAccountDisplayName({
          account_name: accountName,
          instagram_page_id: "123456789",
        }),
      ).toBeNull();
      expect(resolveInstagramSourceLabel({ account_name: accountName })).toBe("Instagram Direct");
    },
  );

  it("falls back to a neutral source name instead of a page or database id", () => {
    expect(
      resolveInstagramSourceLabel({
        instagram_page_id: "17841400000000000",
      }),
    ).toBe("Instagram Direct");
  });
});
