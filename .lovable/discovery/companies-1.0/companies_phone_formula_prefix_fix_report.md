# CRM Companies — Phone Formula Prefix Fix (PR #53) Execution Report

- **PR / commit:** PR #53, commit `8b419712c`
- **Migration:** `supabase/migrations/20260720269000_crm_company_phone_formula_prefix_fix.sql`
- **Applied timestamp (Lovable executor):** `20260720-190414` (managed migration OK, без ошибок)
- **Scope:** только CRM Companies. Не тронуты вебинары, live-events, платежи, интеграции, UI, edge-функции, RLS-политики, другие миграции.

## Что сделано миграцией

1. `CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(_raw text)` — IMMUTABLE, `search_path=public`. Перед BY-нормализацией отрезается ведущий Excel/Sheets `=` (в том числе цепочка `==`). Далее логика полностью совпадает с PR #53 (commit `19b0632a6`): `+375…` / `80…` / `375…` / голый 9-значный → E.164 `+375XXXXXXXXX`, иначе `NULL`.
2. `CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(_arr jsonb)` — SQL, IMMUTABLE, `search_path=public`. Проходит массив, применяет скалярную перегрузку к каждому элементу; нераспознанные значения сохраняются как есть (никогда не выбрасываются вслепую). Не-массив → `NULL`.
3. Разовый backfill только для строк с ведущим `=`:
   - `UPDATE public.companies SET phone = crm_normalize_company_phone(phone) WHERE phone LIKE '=%'` (только если результат ненулевой и отличается).
   - `UPDATE public.companies SET metadata = jsonb_set(..., crm_normalize_company_phone(metadata #> '{google_sheet_import,phones}'), false)` для строк, где в массиве хотя бы один элемент начинается с `=`.
4. Канонические `+375XXXXXXXXX` и любые другие значения не переписываются.

## Runtime-проверка

### Обе перегрузки существуют

```
SELECT proname, pg_get_function_identity_arguments(oid) AS args, pg_get_function_result(oid) AS ret
FROM pg_proc WHERE proname='crm_normalize_company_phone';
-- crm_normalize_company_phone | _arr jsonb | jsonb
-- crm_normalize_company_phone | _raw text  | text
```

### Скалярная перегрузка

| input | output |
| --- | --- |
| `=+375291234567` | `+375291234567` |
| `=80291234567` | `+375291234567` |
| `==+375171111111` | `+375171111111` |
| `+375291234567` | `+375291234567` (без изменений) |
| `=abc` | `NULL` |

### jsonb-перегрузка

```
SELECT crm_normalize_company_phone('["=+375291234567","=80171111111","+375291112233","garbage"]'::jsonb);
-- ["+375291234567", "+375171111111", "+375291112233", "garbage"]
```

Нераспознанное значение `"garbage"` сохранено как есть; остальные приведены к E.164.

### Триггер `trg_companies_normalize_phone`

Существует и активен (унаследован из PR trunk-fix): применяет скалярную перегрузку на любой INSERT/UPDATE `companies.phone`, поэтому новые импорты автоматически теряют ведущий `=`.

### Данные Companies

- До миграции: `phone LIKE '=%'` → **2573** строки (все вида `=+375…`), `metadata.google_sheet_import.phones[]` с ведущим `=` → **2520** строк.
- После миграции:
  - `phone LIKE '=%'` → **0**.
  - `metadata.google_sheet_import.phones[]` с ведущим `=` → **0** элементов в **0** компаниях.
  - Каноничных `+375XXXXXXXXX` в `companies.phone`: **6096** (было 3563 до PR #53 trunk-fix; после текущего backfill добавились ранее заблокированные `=+375…` номера).

Все затронутые телефоны теперь E.164 и используются каноническими `CallButton` / `SmsButton` (`tel:` + `websms-send` без фиктивного contact/profile_id — см. предыдущий CRM UI patch).

## Typecheck

`bunx tsgo -p tsconfig.app.json` — чисто, ошибок нет (UI и код не менялись).

## Что НЕ сделано (out-of-scope)

- Не менялся UI, edge-функции, RPC (кроме двух перегрузок нормализатора), другие миграции, RLS.
- Не тронуты вебинарные / live-events / payment / integration домены.
- Не удалялись и не «угадывались» нераспознанные значения — jsonb-перегрузка сохраняет исходник.

## Изменённые файлы

- `supabase/migrations/20260720269000_crm_company_phone_formula_prefix_fix.sql` (новая, применена)
- `.lovable/discovery/companies-1.0/companies_phone_formula_prefix_fix_report.md` (этот отчёт)
