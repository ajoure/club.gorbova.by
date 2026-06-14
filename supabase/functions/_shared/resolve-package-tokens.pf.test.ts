// PATCH-PACKAGE-CUSTOM-FIELDS-V1 — pf-XXXXXX resolver tests.
//
// Покрывают три сценария:
//   1) valid pf-token → значение из session_field_values, форматирование по типу;
//   2) pf-token из другого пакета → code = 'pf_token_outside_bound_package';
//   3) pf-token обязательный без значения → code = 'pf_required_value_missing'.
//
// Мокаем supabase client минимально: каждая from()→select()→eq()/is()/maybeSingle()
// возвращает заранее подготовленные строки. Это unit-уровень, без сети.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePackageTokenCore } from "./resolve-package-tokens.ts";

type Row = Record<string, unknown> | null;

interface Step {
  table: string;
  match?: Record<string, unknown>;
  row?: Row;
  rows?: Row[];
}

function buildMock(steps: Step[]) {
  // Каждый вызов .from(table) ищет первую неиспользованную запись с тем же table.
  const used = new Set<number>();
  function from(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      neq: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => pick(),
      maybeSingle: () => pick(),
      then: (resolve: (r: unknown) => void) => resolve(pick()),
    };
    function pick() {
      for (let i = 0; i < steps.length; i += 1) {
        if (used.has(i)) continue;
        const s = steps[i];
        if (s.table !== table) continue;
        if (s.match) {
          const ok = Object.entries(s.match).every(([k, v]) => filters[k] === v);
          if (!ok) continue;
        }
        used.add(i);
        return Promise.resolve({ data: s.row ?? s.rows ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
    return builder;
  }
  // deno-lint-ignore no-explicit-any
  return { from } as any;
}

const PKG_A = "11111111-1111-1111-1111-111111111111";
const PKG_B = "22222222-2222-2222-2222-222222222222";
const FIELD_ID = "33333333-3333-3333-3333-333333333333";
const ITEM_ID = "44444444-4444-4444-4444-444444444444";
const SESSION_ID = "55555555-5555-5555-5555-555555555555";

Deno.test("pf-XXXXXX: valid token resolves to formatted value", async () => {
  const supabase = buildMock([
    {
      table: "document_package_field_catalog",
      row: {
        id: FIELD_ID,
        package_template_id: PKG_A,
        field_key: "company_name",
        data_type: "text",
        options: {},
        required: false,
        is_active: true,
        label: "Company",
      },
    },
    {
      table: "document_package_template_items",
      row: { package_template_id: PKG_A },
    },
    {
      table: "document_package_session_field_values",
      row: {
        value_text: "ООО Пример",
        value_number: null,
        value_date: null,
        value_datetime: null,
        value_time: null,
        value_boolean: null,
        value_json: null,
      },
    },
  ]);

  const res = await resolvePackageTokenCore({
    rawToken: "pf-000123",
    packageSessionId: SESSION_ID,
    packageTemplateItemId: ITEM_ID,
    supabase,
  });

  assertEquals(res.resolved, true);
  if (res.resolved) {
    assertEquals(res.value, "ООО Пример");
    assertEquals(res.canonicalFieldPublicId, "pf-000123");
  }
});

Deno.test("pf-XXXXXX: token from another package → pf_token_outside_bound_package", async () => {
  const supabase = buildMock([
    {
      table: "document_package_field_catalog",
      row: {
        id: FIELD_ID,
        package_template_id: PKG_B, // другой пакет!
        field_key: "x",
        data_type: "text",
        options: {},
        required: false,
        is_active: true,
        label: "X",
      },
    },
    {
      table: "document_package_template_items",
      row: { package_template_id: PKG_A },
    },
  ]);

  const res = await resolvePackageTokenCore({
    rawToken: "pf-000999",
    packageSessionId: SESSION_ID,
    packageTemplateItemId: ITEM_ID,
    supabase,
  });

  assertEquals(res.resolved, false);
  if (!res.resolved) assertEquals(res.code, "pf_token_outside_bound_package");
});

Deno.test("pf-XXXXXX: required without value → pf_required_value_missing", async () => {
  const supabase = buildMock([
    {
      table: "document_package_field_catalog",
      row: {
        id: FIELD_ID,
        package_template_id: PKG_A,
        field_key: "x",
        data_type: "text",
        options: {},
        required: true,
        is_active: true,
        label: "X",
      },
    },
    {
      table: "document_package_template_items",
      row: { package_template_id: PKG_A },
    },
    {
      table: "document_package_session_field_values",
      row: null,
    },
  ]);

  const res = await resolvePackageTokenCore({
    rawToken: "pf-000777",
    packageSessionId: SESSION_ID,
    packageTemplateItemId: ITEM_ID,
    supabase,
  });

  assertEquals(res.resolved, false);
  if (!res.resolved) assertEquals(res.code, "pf_required_value_missing");
});

Deno.test("pf-XXXXXX: unknown token → pf_token_not_found", async () => {
  const supabase = buildMock([
    { table: "document_package_field_catalog", row: null },
  ]);

  const res = await resolvePackageTokenCore({
    rawToken: "pf-000404",
    packageSessionId: SESSION_ID,
    packageTemplateItemId: ITEM_ID,
    supabase,
  });

  assertEquals(res.resolved, false);
  if (!res.resolved) assertEquals(res.code, "pf_token_not_found");
});
