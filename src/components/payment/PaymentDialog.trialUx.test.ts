import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "PaymentDialog.tsx"),
  "utf8",
);

describe("PaymentDialog trial UX", () => {
  it("does not suggest paying by another card for a no-card trial failure", () => {
    expect(source).toContain(
      '? data?.error || "Не удалось активировать демо-доступ. Попробуйте ещё раз."',
    );
    expect(source).toContain(
      '{isTrial ? "Не удалось активировать демо-доступ" : "Не удалось продолжить оплату"}',
    );
  });

  it("explains that a free demo can be activated only once", () => {
    expect(source).toContain(
      "Бесплатный демо-доступ к этому продукту можно активировать только один раз.",
    );
    expect(source).not.toContain("Продолжите со скидкой!");
  });

  it("collects a password before creating a no-card trial account", () => {
    expect(source).toContain('id="dialog_signup_password"');
    expect(source).toContain("customerPassword: existingUserId ? undefined : formData.password");
    expect(source).toContain("trial account sign-in failed");
    expect(source).toContain("После активации вы сразу войдёте в личный кабинет");
  });
});
