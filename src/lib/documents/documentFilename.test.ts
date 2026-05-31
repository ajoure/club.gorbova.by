import { describe, it, expect } from "vitest";
import {
  validateFilenameTemplateSyntax,
  templateHasDocNumberFld,
  renderFileName,
} from "./documentFilename";

describe("documentFilename — scope-aware grammar (Sprint 3K)", () => {
  describe("package scope accepts package/ln tokens (with modifiers)", () => {
    it("accepts {{package.ul.FLD-000011}}", () => {
      const r = validateFilenameTemplateSyntax(
        "Приказ {{package.ul.FLD-000011}}",
        "package",
      );
      expect(r.ok).toBe(true);
      expect(r.invalid).toEqual([]);
    });

    it("accepts {{package.ul.FLD-000014|format=signature_short}}", () => {
      const r = validateFilenameTemplateSyntax(
        "Приказ {{package.ul.FLD-000014|format=signature_short}}",
        "package",
      );
      expect(r.ok).toBe(true);
    });

    it("accepts {{ln-000012}}", () => {
      const r = validateFilenameTemplateSyntax(
        "Назначение {{ln-000012}}",
        "package",
      );
      expect(r.ok).toBe(true);
    });

    it("accepts {{ln-000012|format=signature_short}}", () => {
      const r = validateFilenameTemplateSyntax(
        "Назначение {{ln-000012|format=signature_short}}",
        "package",
      );
      expect(r.ok).toBe(true);
    });

    it("accepts {{field:FLD-000133}}", () => {
      const r = validateFilenameTemplateSyntax(
        "Дата {{field:FLD-000133}}",
        "package",
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("billing scope rejects package/ln tokens", () => {
    it("rejects {{package.ul.FLD-000011}} in billing scope", () => {
      const r = validateFilenameTemplateSyntax(
        "Счёт {{package.ul.FLD-000011}}",
        "billing",
      );
      expect(r.ok).toBe(false);
      expect(r.invalid).toContain("package.ul.FLD-000011");
    });

    it("rejects {{ln-000012}} in billing scope", () => {
      const r = validateFilenameTemplateSyntax(
        "Счёт {{ln-000012}}",
        "billing",
      );
      expect(r.ok).toBe(false);
      expect(r.invalid).toContain("ln-000012");
    });

    it("accepts {{field:FLD-000069}} in billing scope", () => {
      const r = validateFilenameTemplateSyntax(
        "Счёт № {{field:FLD-000069}}",
        "billing",
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("FLD-000069 is not required (warning-only)", () => {
    it("templateHasDocNumberFld=false for package template без FLD-000069", () => {
      expect(
        templateHasDocNumberFld("Приказ {{package.ul.FLD-000011}}"),
      ).toBe(false);
    });

    it("validate проходит без FLD-000069", () => {
      const r = validateFilenameTemplateSyntax(
        "Приказ {{package.ul.FLD-000011}}",
        "package",
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("renderFileName — package scope", () => {
    it("renders package + ln + field tokens", () => {
      const r = renderFileName(
        "Приказ {{package.ul.FLD-000011}} {{ln-000012}} от {{field:FLD-000133}}",
        {
          "package.ul.FLD-000011": "Тестовая Компания",
          "ln-000012": "Иванов И.И.",
          "FLD-000133": "21.05.2026",
        },
        "package",
      );
      expect(r.warnings).toEqual([]);
      expect(r.name).toBe("Приказ Тестовая Компания Иванов И.И. от 21.05.2026");
    });

    it("warns when package token unresolved", () => {
      const r = renderFileName(
        "{{package.ul.FLD-000011}}",
        {},
        "package",
      );
      expect(r.warnings).toContain(
        "file_name_placeholder_unresolved:package.ul.FLD-000011",
      );
    });
  });
});
