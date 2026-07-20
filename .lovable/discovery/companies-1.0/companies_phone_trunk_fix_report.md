# CRM Companies — Phone Trunk Fix (PR #53) Execution Report

- **PR / commit:** PR #53, commit `19b0632a6`
- **Migration:** `supabase/migrations/20260720268000_crm_company_phone_trunk_fix.sql`
- **Applied timestamp (Lovable executor):** `20260720-184448` (managed migration OK, без ошибок)
- **Scope:** только CRM Companies. Не тронуты вебинары, live-events, платежи, UI, другие миграции.

## Что сделано миграцией

1. `CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(text)` — IMMUTABLE, `search_path=public`. Приводит:
   - `80XXXXXXXXX` (11 цифр, префикс 80) → `+375XXXXXXXXX`
   - `375XXXXXXXXX` без `+` → `+375XXXXXXXXX`
   - Уже канонический `+375XXXXXXXXX` → без изменений
   - Голый 9-значный субскрайбер BY → `+375XXXXXXXXX`
   - Прочие форматы с `+` длиной 8–15 цифр → нормализуются как `+<digits>`
   - Всё иное → `NULL` (не гадаем)
2. `crm_companies_normalize_phone_tg()` + BEFORE INSERT/UPDATE OF `phone` триггер `trg_companies_normalize_phone` на `public.companies`.
3. Backfill:
   - `UPDATE public.companies SET phone = crm_normalize_company_phone(phone)` для строк с trunk-форматом `80…`.
   - `UPDATE … metadata #> '{google_sheet_import,phones}'` — каждый элемент массива, соответствующий `^80[0-9]{9}$`, заменён на `+375…`. Остальные элементы оставлены как есть.

## Runtime-проверка

### Функция

```
SELECT crm_normalize_company_phone('80291234567');  -- +375291234567
SELECT crm_normalize_company_phone('80172319912');  -- +375172319912
SELECT crm_normalize_company_phone('+375291112233');-- +375291112233
SELECT crm_normalize_company_phone('375291112233'); -- +375291112233
SELECT crm_normalize_company_phone('291112233');    -- +375291112233
SELECT crm_normalize_company_phone(NULL);           -- NULL
```

Все результаты соответствуют ожиданиям.

### Триггер

```
SELECT tgname FROM pg_trigger WHERE tgrelid='public.companies'::regclass AND NOT tgisinternal;
-- trg_companies_normalize_phone
-- trg_set_companies_public_id
-- update_companies_updated_at
```

Триггер существует и активен.

### Данные Companies

- До миграции: `phone ~ '^80[0-9]{9}$'` → **3 строки** (примеры `9bab3055…`, `049dcf92…`, `74c3a8a6…`), `phones[]` с trunk-форматом → **3 компании**.
- После миграции:
  - `phone ~ '^80[0-9]{9}$'` → **0 строк**.
  - `metadata.google_sheet_import.phones[]` с trunk-форматом → **0 компаний**.
  - Пример строк (все три ранее «сломанных»):
    | id | phone | metadata phones[] |
    | --- | --- | --- |
    | `9bab3055…` | `+375172319912` | `["+375172319912"]` |
    | `049dcf92…` | `+375171692102` | `["+375171692102"]` |
    | `74c3a8a6…` | `+375172860233` | `["+375172860233"]` |
  - Каноничных `+375XXXXXXXXX` в `companies.phone`: **3563**.

Все затронутые телефоны теперь в E.164, поэтому кнопки Call (`tel:`) и SMS (`websms-send`, ожидающие `+375…`) отработают штатно.

## Что НЕ сделано (out-of-scope)

- Не изменялся UI, edge-функции, другие миграции.
- Не трогали вебинарные/live/payment/integration таблицы.
- Отдельная проблема «=+375…» префиксов (2572 строки, следы CSV/Excel-артефактов) — вне scope PR #53; функция такие значения возвращает как `NULL` (не заменяет вслепую), backfill их не трогает, они остаются на отдельный PR.

## Изменённые файлы

- `supabase/migrations/20260720268000_crm_company_phone_trunk_fix.sql` (новая)
- `.lovable/discovery/companies-1.0/companies_phone_trunk_fix_report.md` (этот отчёт)
