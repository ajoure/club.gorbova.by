import { describe, expect, it } from "vitest";
import { formatLiveEventDate } from "./formatLiveEventDate";

describe("formatLiveEventDate", () => {
  it("formats a UTC timestamp in the event timezone instead of the browser timezone", () => {
    expect(formatLiveEventDate("2026-08-29T07:00:00.000Z", "Europe/Minsk"))
      .toBe("29 августа 2026, 10:00");
  });

  it("keeps the same instant distinct across event timezones", () => {
    expect(formatLiveEventDate("2026-08-29T07:00:00.000Z", "Europe/Warsaw"))
      .toBe("29 августа 2026, 09:00");
  });

  it("fails safely for invalid timestamps or timezones", () => {
    expect(formatLiveEventDate("not-a-date", "Europe/Minsk")).toBe("—");
    expect(formatLiveEventDate("2026-08-29T07:00:00.000Z", "Invalid/Timezone")).toBe("—");
  });
});
