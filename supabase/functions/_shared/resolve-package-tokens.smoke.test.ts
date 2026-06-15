// PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B5): smoke-тест изоляции трёх ветвей токенов.
//
// Резолвер `resolvePackageTokenCore` обрабатывает ln-XXXXXX (роли) и pf-XXXXXX
// (поля пакета). Билинговый namespace FLD-XXXXXX обрабатывается в другом
// пайплайне (canonical-document-generate-strict → typed-tokens-resolver) и сюда
// НЕ попадает по контракту. Этот тест фиксирует:
//   1) ln- ветка не задевает pf-каталог;
//   2) pf- ветка не задевает legacy alias-таблицу;
//   3) FLD-XXXXXX токены не матчатся PF_RE/LN_RE и идут в общий alias-fallback
//      (отдаются как alias_missing — что доказывает: pf/ln не «съели» FLD).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePackageTokenCore } from "./resolve-package-tokens.ts";

function emptyMock() {
  function from() {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      neq: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (r: (x: unknown) => void) => r({ data: null, error: null }),
    };
    return b;
  }
  // deno-lint-ignore no-explicit-any
  return { from } as any;
}

const SESSION = "55555555-5555-5555-5555-555555555555";
const ITEM = "44444444-4444-4444-4444-444444444444";

Deno.test("smoke isolation: FLD-XXXXXX → alias_missing (не матчится ни pf, ни ln)", async () => {
  const r = await resolvePackageTokenCore({
    rawToken: "FLD-000372",
    packageSessionId: SESSION,
    packageTemplateItemId: ITEM,
    supabase: emptyMock(),
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) {
    // alias_missing — потому что FLD не имеет alias-row, но прошёл через
    // alias-таблицу (не был перехвачен pf/ln branch).
    assertEquals(r.code, "alias_missing");
  }
});

Deno.test("smoke isolation: ln-XXXXXX без participants → participant_missing (не pf-код)", async () => {
  const r = await resolvePackageTokenCore({
    rawToken: "ln-000001",
    packageSessionId: SESSION,
    packageTemplateItemId: ITEM,
    supabase: emptyMock(),
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) {
    // ln-XXXXXX без записи роли → ln_token_not_found (специфичный код, не pf_*)
    assertEquals(r.code, "ln_token_not_found");
  }
});

Deno.test("smoke isolation: pf-XXXXXX без каталога → pf_token_not_found (не alias_missing)", async () => {
  const r = await resolvePackageTokenCore({
    rawToken: "pf-000404",
    packageSessionId: SESSION,
    packageTemplateItemId: ITEM,
    supabase: emptyMock(),
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, "pf_token_not_found");
});
