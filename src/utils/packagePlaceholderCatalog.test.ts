import { describe, it, expect } from "vitest";
import {
  PACKAGE_PLACEHOLDER_CATALOG,
  PACKAGE_GROUP_META,
  getPackagePlaceholdersByGroup,
  buildPackageRoleItems,
  buildPackagePlaceholderToken,
  classifyPackageItem,
  supportsLongFormat,
  type PackageRoleCatalogRow,
  type PackagePlaceholderItem,
} from "./packagePlaceholderCatalog";

describe("packagePlaceholderCatalog — Sprint 3D/3F", () => {
  it("содержит четыре группы: Пакет ЮЛ / ИП / ФЛ / Роли", () => {
    expect(PACKAGE_GROUP_META.map((g) => g.id).sort()).toEqual(
      ["package_fl", "package_ip", "package_roles", "package_ul"].sort(),
    );
    const labels = PACKAGE_GROUP_META.map((g) => g.label_ru);
    expect(labels).toContain("Пакет: ЮЛ");
    expect(labels).toContain("Пакет: ИП");
    expect(labels).toContain("Пакет: ФЛ");
    expect(labels).toContain("Пакет: Роли");
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

  it("Sprint 3E: адресный breakdown UL/IP/FL имеет jsonb-path source", () => {
    const addr = PACKAGE_PLACEHOLDER_CATALOG.filter(
      (i) => i.status === "copy_ready" && /Адрес:/.test(i.label_ru) && i.label_ru !== "Юридический адрес (полный)" && i.label_ru !== "Адрес полный",
    );
    expect(addr.length).toBeGreaterThan(0);
    for (const i of addr) {
      expect(i.source_path).toMatch(/_structured->>'[a-z_]+'$/);
    }
  });

  it("Sprint 3E: банк-реквизиты ФЛ — copy_ready через legal_details_persons.bank_*", () => {
    const flBank = getPackagePlaceholdersByGroup("package_fl").filter((i) =>
      /package\.fl\.bank_/.test(i.tech_key),
    );
    expect(flBank.length).toBe(3);
    for (const i of flBank) {
      expect(i.status).toBe("copy_ready");
      expect(i.source_table).toBe("legal_details_persons");
      expect(i.source_path).toMatch(/^legal_details_persons\.bank_/);
    }
  });

  // Sprint 3H-fix: канон роли — {{ln-XXXXXX}}, legacy package.role.PKR/package.roles.* запрещены в каталоге
  it("buildPackageRoleItems генерирует ровно один {{ln-XXXXXX}} токен на роль (канон Sprint 3H)", () => {
    const rows: PackageRoleCatalogRow[] = [
      {
        public_id: "ln-000003",
        role_key: "ideology_responsible",
        label: "Ответственный за идеологическую работу",
        description: null,
        is_system: true,
        is_active: true,
        package_template_id: "pkg-1",
        package_template_name: "Идеология",
        output_template: null,
        sort_order: 3,
      },
      {
        public_id: "ln-000099",
        role_key: "custom_role_x",
        label: "Кастомная роль X",
        description: null,
        is_system: false,
        is_active: true,
        package_template_id: "pkg-1",
        package_template_name: "Идеология",
        output_template: "{{full_name}} ({{position}})",
        sort_order: 99,
      },
    ];
    const items = buildPackageRoleItems(rows);
    expect(items.length).toBe(2);
    expect(items[0].package_token).toBe("{{ln-000003}}");
    expect(items[1].package_token).toBe("{{ln-000099}}");
    expect(items[0].groupId).toBe("package_roles");
    expect(items[0].status).toBe("copy_ready");
    for (const i of items) {
      expect(i.package_token).not.toMatch(/package\.role\.PKR-/);
      expect(i.package_token).not.toMatch(/package\.roles\./);
      expect(i.package_token).not.toMatch(/\.(full_name|short_name|position)/);
      // ровно один copy-token
      expect((i.package_token!.match(/\{\{/g) || []).length).toBe(1);
    }
  });

  it("buildPackageRoleItems отфильтровывает is_active=false", () => {
    const rows: PackageRoleCatalogRow[] = [
      {
        public_id: "ln-000001", role_key: "x", label: "X",
        description: null, is_system: true, is_active: false,
        package_template_id: "p", package_template_name: "P",
        output_template: null, sort_order: 1,
      },
    ];
    expect(buildPackageRoleItems(rows)).toEqual([]);
  });

  it("в каталоге групп нет legacy package.roles.<key>.* и package.role.PKR- токенов", () => {
    const stringified = JSON.stringify(PACKAGE_PLACEHOLDER_CATALOG);
    expect(stringified).not.toContain("package.roles.");
    expect(stringified).not.toContain("package.role.PKR-");
  });
});

