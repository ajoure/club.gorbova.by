import { describe, expect, it } from "vitest";
import { renderContactCenterMessagePlaceholders } from "./contactCenterMessagePlaceholders";

describe("renderContactCenterMessagePlaceholders", () => {
  it("resolves the selected dialog context without changing an unknown token", () => {
    expect(renderContactCenterMessagePlaceholders(
      "Здравствуйте, {{first_name}} {{last_name}} (@{{telegram_username}}). {{today}} / {{unknown}}",
      { fullName: "Анна Тютюнова", telegramUsername: "@anna", now: new Date("2026-08-17T10:00:00Z") },
    )).toBe("Здравствуйте, Анна Тютюнова (@anna). 17.08.2026 / {{unknown}}");
  });
});
