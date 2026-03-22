## да, согласен, с учетом правок:

&nbsp;

1. В PATCH 1 проверь не только перечисленные файлы вручную, но и **полный repo-wide поиск** всех вхождений:
  &nbsp;
  - client_legal_details
  - is_default
  - client_details_id
  - leg_unp
  - ent_unp
    Иначе можно пропустить скрытые зависимости вне основного списка файлов.
  &nbsp;
2. В аудит обязательно включи **точный источник RLS/policies**:
  &nbsp;
  - миграции, где создавались policy для client_legal_details
  - текущий фактический SQL policy text
  - кто имеет SELECT/INSERT/UPDATE/DELETE
    Не ограничивайся только общим выводом “RLS есть”.
  &nbsp;
3. В результате PATCH 1 нужен не просто “DDL-решение обосновано”, а **таблица вариантов**:
  &nbsp;
  - вариант 1: одно поле
  - вариант 2: два поля
  - вариант 3: enum/иная схема
    Для каждого:
  - плюсы
  - риски
  - влияние на текущие queries
  - почему подходит/не подходит.
  &nbsp;
4. Отдельно зафиксируй **все текущие места fallback-логики**:
  &nbsp;
  - когда берут явный client_details_id
  - когда берут запись по is_default
  - что происходит, если default отсутствует
  - что происходит, если записей несколько
    Это критично для будущего разграничения billing/document.
  &nbsp;
5. В PATCH 1 нужен отдельный блок **UX/flow impact**:
  &nbsp;
  - как текущее /settings/legal-details показывает записи
  - есть ли там предположение, что все записи одинакового назначения
  - что сломается визуально/логически, если появятся document-entities.
  &nbsp;
6. В deliverables добавь явный артефакт:
  &nbsp;
  - docs/PATCH_1_CLIENT_LEGAL_DETAILS_[AUDIT.md](http://AUDIT.md)
    В нем должны быть:
  - dependency map
  - RLS section
  - options comparison
  - recommendation
  - список мест, которые нельзя сломать.
  &nbsp;
7. В DoD добавь proof-пункт:
  &nbsp;
  - показать список всех найденных файлов/вхождений по repo-wide search
  - показать итоговую рекомендованную модель разграничения
  - подтвердить, что **код не менялся вообще**.
  &nbsp;

&nbsp;

&nbsp;

PATCH 1 — Диагностика `client_legal_details`: разграничение use-case

### Scope

Read-only аудит. Никакого DDL, никаких миграций, никаких изменений кода.

### Что нужно проверить

1. **Все SELECT по `is_default**` в hooks и edge functions — где и как определяется "основная" запись
2. **Все INSERT/UPDATE** в `useLegalDetails` — как создаются/обновляются записи
3. `**generate-from-template**` — как выбирает `client_details_id` (по параметру или по `is_default`)
4. `**generate-document-pdf**`, `**generate-invoice-act**`, `**document-auto-generate**` — аналогичная проверка
5. `**/settings/legal-details**` — фильтрует ли по каким-то признакам или показывает все записи `profile_id`
6. **RLS policies** на `client_legal_details` — текущие правила доступа

### Результат

Таблица зависимостей + обоснованное DDL-решение:

- Нужно ли одно поле `purpose` (`billing` / `document`)
- Или два поля (`purpose` + `status`)
- Или enum
- Как это не ломает текущие запросы (все существующие записи получают default = текущее поведение)

### Файлы для аудита

- `src/hooks/useLegalDetails.tsx`
- `supabase/functions/generate-from-template/index.ts`
- `supabase/functions/generate-document-pdf/index.ts`
- `supabase/functions/generate-invoice-act/index.ts`
- `supabase/functions/document-auto-generate/index.ts`
- `src/pages/settings/LegalDetails.tsx`
- `src/lib/token-resolver.ts`
- RLS policies через `supabase--read_query`

### DoD

- Аудит всех зависимостей `is_default` и `client_details_id` завершён
- Семантика разграничения зафиксирована
- DDL-решение обосновано без регресса для billing
- Код не менялся