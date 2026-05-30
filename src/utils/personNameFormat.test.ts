import { describe, it, expect } from "vitest";
import { formatPersonName, DEMO_PERSON_NAME } from "./personNameFormat";

describe("formatPersonName — Sprint 3J-Roles canon", () => {
  describe("Иванов Иван Иванович", () => {
    const name = "Иванов Иван Иванович";

    it("format=full → как есть", () => {
      expect(formatPersonName(name)).toBe("Иванов Иван Иванович");
      expect(formatPersonName(name, { format: "full" })).toBe("Иванов Иван Иванович");
    });

    it("format=short → Иванов И.И. (без пробела между инициалами)", () => {
      expect(formatPersonName(name, { format: "short" })).toBe("Иванов И.И.");
    });

    it("format=signature_short → И.И.Иванов (без пробелов)", () => {
      expect(formatPersonName(name, { format: "signature_short" })).toBe("И.И.Иванов");
    });

    it("case=genitive + full → Иванова Ивана Ивановича", () => {
      expect(formatPersonName(name, { format: "full", case: "genitive" }))
        .toBe("Иванова Ивана Ивановича");
    });

    it("case=genitive + short → Иванова И.И.", () => {
      expect(formatPersonName(name, { format: "short", case: "genitive" }))
        .toBe("Иванова И.И.");
    });

    it("case=genitive + signature_short → И.И.Иванова", () => {
      expect(formatPersonName(name, { format: "signature_short", case: "genitive" }))
        .toBe("И.И.Иванова");
    });
  });

  describe("Федорчук Сергей Валерьевич (DEMO)", () => {
    const name = DEMO_PERSON_NAME;

    it("format=full → Федорчук Сергей Валерьевич", () => {
      expect(formatPersonName(name, { format: "full" })).toBe("Федорчук Сергей Валерьевич");
    });

    it("format=short → Федорчук С.В.", () => {
      expect(formatPersonName(name, { format: "short" })).toBe("Федорчук С.В.");
    });

    it("format=signature_short → С.В.Федорчук", () => {
      expect(formatPersonName(name, { format: "signature_short" })).toBe("С.В.Федорчук");
    });

    it("case=genitive + full → Федорчука Сергея Валерьевича", () => {
      expect(formatPersonName(name, { format: "full", case: "genitive" }))
        .toBe("Федорчука Сергея Валерьевича");
    });

    it("case=genitive + short → Федорчука С.В.", () => {
      expect(formatPersonName(name, { format: "short", case: "genitive" }))
        .toBe("Федорчука С.В.");
    });

    it("case=genitive + signature_short → С.В.Федорчука", () => {
      expect(formatPersonName(name, { format: "signature_short", case: "genitive" }))
        .toBe("С.В.Федорчука");
    });
  });

  describe("Edge cases", () => {
    it("пустая строка → пустая строка", () => {
      expect(formatPersonName("")).toBe("");
      expect(formatPersonName(null)).toBe("");
      expect(formatPersonName(undefined)).toBe("");
    });

    it("один токен → возвращается как есть", () => {
      expect(formatPersonName("Cher", { format: "short" })).toBe("Cher");
      expect(formatPersonName("Иванов", { format: "signature_short" })).toBe("Иванов");
    });

    it("два токена (без отчества) → инициал один", () => {
      expect(formatPersonName("Иванов Иван", { format: "short" })).toBe("Иванов И.");
      expect(formatPersonName("Иванов Иван", { format: "signature_short" })).toBe("И.Иванов");
    });

    it("нормализует лишние пробелы", () => {
      expect(formatPersonName("  Иванов   Иван   Иванович  ", { format: "short" }))
        .toBe("Иванов И.И.");
    });

    it("nominative + short — то же что без падежа", () => {
      expect(formatPersonName("Иванов Иван Иванович", { format: "short", case: "nominative" }))
        .toBe("Иванов И.И.");
    });
  });

  describe("Женские ФИО (regression)", () => {
    it("Иванова Мария Петровна, genitive → Ивановой Марии Петровны", () => {
      // Базовая проверка ж.р. парадигмы (Иванова → Ивановой).
      expect(formatPersonName("Иванова Мария Петровна", { format: "full", case: "genitive" }))
        .toBe("Ивановой Марии Петровны");
    });

    it("Иванова Мария Петровна, short + genitive → Ивановой М.П.", () => {
      expect(formatPersonName("Иванова Мария Петровна", { format: "short", case: "genitive" }))
        .toBe("Ивановой М.П.");
    });
  });
});
