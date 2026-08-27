import { describe, expect, it } from "vitest";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";

describe("normalizeEdgeFunctionErrorAsync", () => {
  it("reads the JSON body of a FunctionsHttpError response", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };

    await expect(normalizeEdgeFunctionErrorAsync(error)).resolves.toBe(
      "Недостаточно прав для этого действия. Обратитесь к администратору ролей.",
    );
  });

  it.each([
    ["invalid_amount", "Укажите корректную сумму платежа больше нуля."],
    ["invalid_currency", "Выберите поддерживаемую валюту платежа."],
    ["invalid_provider", "Выберите поддерживаемого платёжного провайдера."],
    ["invalid_paid_at", "Укажите корректную дату платежа."],
    [
      "missing_idempotency_key",
      "Не удалось подготовить безопасный ключ платежа. Обновите форму и попробуйте снова.",
    ],
    [
      "rbac_check_failed",
      "Не удалось проверить права доступа. Обновите страницу и попробуйте снова.",
    ],
    [
      "addon_not_allowed",
      "Один из выбранных дополнительных продуктов недоступен для этого способа оплаты.",
    ],
    [
      "admin_fields_forbidden",
      "Недостаточно прав на редактирование платежей.",
    ],
    [
      "rr_battle_credentials_incomplete",
      "Интеграция Ресурса развития не настроена. Обратитесь к администратору.",
    ],
  ])("maps %s from a FunctionsHttpError response", async (code, expected) => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ ok: false, error: code }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    };

    await expect(normalizeEdgeFunctionErrorAsync(error)).resolves.toBe(expected);
  });
});
