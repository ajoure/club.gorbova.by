import { describe, it, expect } from "vitest";
import {
  PACKAGE_PLACEHOLDER_CATALOG,
  PACKAGE_GROUP_META,
  getPackagePlaceholdersByGroup,
} from "./packagePlaceholderCatalog";

describe("packagePlaceholderCatalog — Sprint 3D", () => {
  it("содержит ровно три группы: Пакет ЮЛ / ИП / ФЛ; нет «Пакет: Исполнитель ЮЛ»", () => {
    expect(PACKAGE_GROUP_META.map((g) => g.id).sort()).toEqual(
      ["package_fl", "package_ip", "package_ul"].sort(),
    );
    const labels = PACKAGE_GROUP_META.map((g) => g.label_ru);
    expect(labels).toContain("Пакет: ЮЛ");
    expect(labels).toContain("Пакет: ИП");
    expect(labels).toContain("Пакет: ФЛ");
    expect(labels).not.toContain("Пакет: Исполнитель ЮЛ");
  });

  it("все copy_ready ссылаются на реальный FLD public_id и реальную колонку-источник", () => {
    const ready = PACKAGE_PLACEHOLDER_CATALOG.filter((i) => i.status === "copy_ready");
    expect(ready.length).toBeGreaterThan(0);
    for (const i of ready) {
      expect(i.reused_fld).toMatch(/^FLD-\d{6}$/);
      expect(i.source_table).toMatch(/^(client_legal_details|legal_details_persons)$/);
      expect(i.source_path).toBeTruthy();
      expect(i.package_token).toBeTruthy();
    }
  });

  it("copy-token формат соответствует утверждённому §5 (Variant B)", () => {
    for (const i of PACKAGE_PLACEHOLDER_CATALOG) {
      if (i.status !== "copy_ready") {
        expect(i.package_token).toBeNull();
        continue;
      }
      // {{package.(ul|ip|fl).FLD-XXXXXX}}
      expect(i.package_token).toMatch(/^\{\{package\.(ul|ip|fl)\.FLD-\d{6}\}\}$/);
      const prefix = i.groupId === "package_ul" ? "ul"
        : i.groupId === "package_ip" ? "ip" : "fl";
      expect(i.package_token).toContain(`package.${prefix}.`);
    }
  });

  it("не содержит токенов package.roles.ideology_responsible.*", () => {
    const stringified = JSON.stringify(PACKAGE_PLACEHOLDER_CATALOG);
    expect(stringified).not.toContain("ideology_responsible");
  });

  it("не использует биллинговый {{field:FLD-...}} как copy-токен пакета", () => {
    for (const i of PACKAGE_PLACEHOLDER_CATALOG) {
      if (i.package_token) {
        expect(i.package_token).not.toMatch(/^\{\{field:/);
      }
    }
  });

  it("UL/IP резолвятся через session.selected_legal_entity_id; FL — через session_participants", () => {
    for (const i of getPackagePlaceholdersByGroup("package_ul")) {
      if (i.status === "copy_ready") {
        expect(i.source_table).toBe("client_legal_details");
        expect(i.package_resolver_hint).toContain("selected_legal_entity_id");
      }
    }
    for (const i of getPackagePlaceholdersByGroup("package_ip")) {
      if (i.status === "copy_ready") {
        expect(i.source_table).toBe("client_legal_details");
      }
    }
    for (const i of getPackagePlaceholdersByGroup("package_fl")) {
      if (i.status === "copy_ready") {
        expect(i.source_table).toBe("legal_details_persons");
        expect(i.package_resolver_hint).toContain("session_participants");
      }
    }
  });

  it("у каждого item уникальный tech_key", () => {
    const keys = PACKAGE_PLACEHOLDER_CATALOG.map((i) => i.tech_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("статусы — из утверждённого множества", () => {
    const allowed = new Set([
      "source_available",
      "copy_ready",
      "pending_field",
      "missing_source_column",
      "deferred",
    ]);
    for (const i of PACKAGE_PLACEHOLDER_CATALOG) {
      expect(allowed.has(i.status)).toBe(true);
    }
  });
});
