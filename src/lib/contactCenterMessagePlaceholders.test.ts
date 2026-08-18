import { describe, expect, it } from "vitest";
import { renderContactCenterMessagePlaceholders } from "./contactCenterMessagePlaceholders";

describe("renderContactCenterMessagePlaceholders", () => {
  it("resolves the selected dialog context without changing an unknown token", () => {
    expect(renderContactCenterMessagePlaceholders(
      "Здравствуйте, {{first_name}} {{last_name}} (@{{telegram_username}}). {{today}} / {{unknown}}",
      { fullName: "Анна Тютюнова", telegramUsername: "@anna", now: new Date("2026-08-17T10:00:00Z") },
    )).toBe("Здравствуйте, Анна Тютюнова (@anna). 17.08.2026 / {{unknown}}");
  });

  it("resolves canonical contact and system tokens from explicit profile fields", () => {
    expect(renderContactCenterMessagePlaceholders(
      [
        "{{contact.full_name}}",
        "{{contact.first_name}}",
        "{{contact.last_name}}",
        "{{contact.email}}",
        "{{contact.phone}}",
        "@{{contact.telegram_username}}",
        "{{system.today}}",
        "{{system.weekday}}",
        "{{system.today_long}}",
      ].join(" | "),
      {
        fullName: "Ракитская Вероника",
        firstName: "Вероника",
        lastName: "Ракитская",
        email: "veronika@example.com",
        phone: "+375290000000",
        telegramUsername: "@VRakitskaya",
        now: new Date("2026-08-17T10:00:00Z"),
      },
    )).toBe(
      "Ракитская Вероника | Вероника | Ракитская | veronika@example.com | +375290000000 | @VRakitskaya | 17.08.2026 | понедельник | 17 августа 2026 г.",
    );
  });
});
