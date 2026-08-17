import { describe, expect, it } from "vitest";
import { tokenStringToLabel } from "./tokenRegistry";

describe("tokenStringToLabel", () => {
  it("labels computed CRM automation tokens without waiting for registry data", () => {
    expect(tokenStringToLabel("{{deal_number}}")).toBe("Сделка · номер");
    expect(tokenStringToLabel("{{customer_name}}")).toBe("Клиент · полное имя");
    expect(tokenStringToLabel("{{responsible_email}}")).toBe("Ответственный · email");
  });
});
