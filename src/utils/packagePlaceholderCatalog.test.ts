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

describe("packagePlaceholderCatalog — Sprint 3J-UI modifier helpers", () => {
  const ulShort = PACKAGE_PLACEHOLDER_CATALOG.find(
    (i) => i.tech_key === "package.ul.short_name",
  )!;
  const ulOrgForm = PACKAGE_PLACEHOLDER_CATALOG.find(
    (i) => i.tech_key === "package.ul.org_form",
  )!;
  const flBirth = PACKAGE_PLACEHOLDER_CATALOG.find(
    (i) => i.tech_key === "package.fl.birth_date",
  )!;

  it("copy-токен без модификаторов = базовый package_token", () => {
    expect(buildPackagePlaceholderToken(ulShort, null, null))
      .toBe("{{package.ul.FLD-000011}}");
  });

  it("copy-токен с case=genitive добавляет |case=genitive", () => {
    expect(buildPackagePlaceholderToken(ulShort, null, "genitive"))
      .toBe("{{package.ul.FLD-000011|case=genitive}}");
  });

  it("copy-токен с format=long доступен только для org_form", () => {
    expect(buildPackagePlaceholderToken(ulOrgForm, "long", null))
      .toBe("{{package.ul.FLD-000010|format=long}}");
    expect(supportsLongFormat(ulOrgForm)).toBe(true);
    expect(supportsLongFormat(ulShort)).toBe(false);
  });

  it("copy-токен с format + case даёт |format=X|case=Y в правильном порядке", () => {
    expect(buildPackagePlaceholderToken(ulOrgForm, "long", "genitive"))
      .toBe("{{package.ul.FLD-000010|format=long|case=genitive}}");
  });

  it("classifyPackageItem: person_name для ФИО-полей, date для дат, text для прочих", () => {
    expect(classifyPackageItem(ulShort)).toBe("text");
    expect(classifyPackageItem(ulOrgForm)).toBe("text");
    expect(classifyPackageItem(flBirth)).toBe("date");

    const ulDirector = PACKAGE_PLACEHOLDER_CATALOG.find(
      (i) => i.tech_key === "package.ul.director_full_name",
    )!;
    const flFullName = PACKAGE_PLACEHOLDER_CATALOG.find(
      (i) => i.tech_key === "package.fl.full_name",
    )!;
    expect(classifyPackageItem(ulDirector)).toBe("person_name");
    expect(classifyPackageItem(flFullName)).toBe("person_name");
  });

  it("classifyPackageItem: person_name для package_roles", () => {
    const rolesItem: PackagePlaceholderItem = {
      groupId: "package_roles",
      label_ru: "X",
      source_table: "legal_details_persons",
      source_path: null,
      billing_fld_analog: null,
      reused_fld: null,
      package_token: "{{ln-000001}}",
      package_resolver_hint: "",
      status: "copy_ready",
      tech_key: "ln.ln-000001",
      example_value: null,
    };
    expect(classifyPackageItem(rolesItem)).toBe("person_name");
  });

  it("not-ready item не имеет copy-токена", () => {
    const deferredItem = PACKAGE_PLACEHOLDER_CATALOG.find(
      (i) => i.status !== "copy_ready",
    )!;
    expect(buildPackagePlaceholderToken(deferredItem, null, null)).toBeNull();
  });
});

describe("packagePlaceholderCatalog — Sprint 3J-Roles role modifiers", () => {
  const rolesItem: PackagePlaceholderItem = {
    groupId: "package_roles",
    label_ru: "Демо роль",
    source_table: "legal_details_persons",
    source_path: null,
    billing_fld_analog: null,
    reused_fld: null,
    package_token: "{{ln-000012}}",
    package_resolver_hint: "",
    status: "copy_ready",
    tech_key: "ln.ln-000012",
    example_value: null,
  };
  const ulDirector = PACKAGE_PLACEHOLDER_CATALOG.find(
    (i) => i.tech_key === "package.ul.director_full_name",
  )!;
  const flFullName = PACKAGE_PLACEHOLDER_CATALOG.find(
    (i) => i.tech_key === "package.fl.full_name",
  )!;

  it("ln default (без модификаторов) = {{ln-000012}}", () => {
    expect(buildPackagePlaceholderToken(rolesItem, null, null)).toBe("{{ln-000012}}");
  });

  it("ln + format=short → {{ln-000012|format=short}}", () => {
    expect(buildPackagePlaceholderToken(rolesItem, "short", null))
      .toBe("{{ln-000012|format=short}}");
  });

  it("ln + format=signature_short → {{ln-000012|format=signature_short}}", () => {
    expect(buildPackagePlaceholderToken(rolesItem, "signature_short", null))
      .toBe("{{ln-000012|format=signature_short}}");
  });

  it("ln + format=short + case=genitive → канонический порядок format→case", () => {
    expect(buildPackagePlaceholderToken(rolesItem, "short", "genitive"))
      .toBe("{{ln-000012|format=short|case=genitive}}");
    expect(buildPackagePlaceholderToken(rolesItem, "signature_short", "genitive"))
      .toBe("{{ln-000012|format=signature_short|case=genitive}}");
  });

  it("ln + case без format → только |case=", () => {
    expect(buildPackagePlaceholderToken(rolesItem, null, "genitive"))
      .toBe("{{ln-000012|case=genitive}}");
  });

  it("ln игнорирует format=long/words/text (backend их не понимает у ln)", () => {
    expect(buildPackagePlaceholderToken(rolesItem, "long" as never, null))
      .toBe("{{ln-000012}}");
    expect(buildPackagePlaceholderToken(rolesItem, "words" as never, null))
      .toBe("{{ln-000012}}");
  });

  it("FIO package field (директор ЮЛ) поддерживает format=short", () => {
    expect(buildPackagePlaceholderToken(ulDirector, "short", null))
      .toBe("{{package.ul.FLD-000014|format=short}}");
    expect(buildPackagePlaceholderToken(ulDirector, "signature_short", "genitive"))
      .toBe("{{package.ul.FLD-000014|format=signature_short|case=genitive}}");
  });

  it("FIO package field (ФЛ ФИО) поддерживает format=short", () => {
    expect(buildPackagePlaceholderToken(flFullName, "short", "genitive"))
      .toBe("{{package.fl.FLD-000372|format=short|case=genitive}}");
  });

  it("обычное текстовое package-поле игнорирует format=short/signature_short", () => {
    const ulShort = PACKAGE_PLACEHOLDER_CATALOG.find(
      (i) => i.tech_key === "package.ul.short_name",
    )!;
    expect(buildPackagePlaceholderToken(ulShort, "short" as never, null))
      .toBe("{{package.ul.FLD-000011}}");
  });

  it("в каталоге групп нет PKR/package.role.PKR/package.roles.* / .full_name / .short_name / .position у ln-токенов", () => {
    // sanity: ни один tech_key и ни один package_token не содержит legacy форматов.
    for (const i of PACKAGE_PLACEHOLDER_CATALOG) {
      if (i.package_token) {
        expect(i.package_token).not.toMatch(/PKR-/);
        expect(i.package_token).not.toMatch(/package\.role\./);
        expect(i.package_token).not.toMatch(/package\.roles\./);
      }
    }
  });
});


