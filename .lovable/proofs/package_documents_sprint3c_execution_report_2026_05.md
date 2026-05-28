# Sprint 3C — Execution Report

Дата: 2026-05-28
Статус: **completed** — `package person FLD + role aliases + resolver core + dry-run edge + UI position; HARDCODED_ENABLED остаётся false; generation deferred to Sprint 3D`.

## 1. Discovery (read-only)

### 1.1 participants schema
- `document_package_session_participants.metadata jsonb NOT NULL DEFAULT '{}'::jsonb` — подтверждено.
- RLS-политики: `participants_{select,insert,update,delete}_own` (по profile_id → user_id), admin/super_admin полная.

### 1.2 Role catalog (active)
11 ролей. **Важно:** для физлица-руководителя используется `company_head`, для ответственного — `ideology_responsible` (НЕ `responsible_person`).

### 1.3 Alias table audit — alignment fix
Sprint 3B v2.1 ошибочно прописал `role_key='responsible_person'`, которого нет в каталоге. Применён UPDATE:

```sql
UPDATE public.document_package_token_aliases
SET role_key = 'ideology_responsible'
WHERE role_key = 'responsible_person'
  AND alias_token IN ('package.roles.responsible_person.full_name',
                      'package.roles.responsible_person.position');
-- 2 rows
```
Alias_token намеренно не менялся (это user-facing имя токена в шаблоне). Audit-row `package_alias_role_key_realigned` записан системным актёром.

### 1.4 Uniqueness probe
```
SELECT package_session_id, role_key, COUNT(*)
FROM public.document_package_session_participants
WHERE role_key IN ('company_head','ideology_responsible')
GROUP BY 1,2 HAVING COUNT(*) > 1;  -- 0 rows
```
Дублей нет. Защита `multiple_role_assignments` всё равно вкомпилирована в resolver.

## 2. Resolver refactor (без production wiring)

`supabase/functions/_shared/resolve-package-tokens.ts`:
- Выделена pure-функция `resolvePackageTokenCore(input)` — БЕЗ feature-flag.
- Публичная `resolvePackageToken(input)` сохраняет `if (!HARDCODED_ENABLED) return FEATURE_DISABLED();` guard.
- Добавлен код `multiple_role_assignments` (длина массива участников по роли > 1).
- `package_metadata.source_path` остаётся каноническим `'metadata.position'`.

**HARDCODED_ENABLED = false (подтверждено grep):**
```
$ rg "HARDCODED_ENABLED" supabase/functions/_shared/resolve-package-tokens.ts
export const HARDCODED_ENABLED = false;
if (!HARDCODED_ENABLED) return FEATURE_DISABLED();
```

**Production imports `resolvePackageTokenCore` (должно быть 0 в production-пайплайне):**
- `supabase/functions/package-tokens-dry-run/index.ts` — dev-only edge, super_admin gated, no DB-writes vs business state.
- `supabase/functions/_shared/resolve-package-tokens_test.ts` — Deno-тесты.
- `canonical-document-generate-strict` — НЕ импортирует. Git-diff не затрагивает эту функцию.

## 3. Deno-тесты (10/10 pass)

```
running 10 tests from ./supabase/functions/_shared/resolve-package-tokens_test.ts
HARDCODED_ENABLED stays false in Sprint 3C ............................ ok
public resolvePackageToken returns feature_off (flag guard intact) .... ok
alias_missing → code alias_missing ..................................... ok
participant_missing when no row for role ............................... ok
package_person happy path .............................................. ok
package_person without person_id → no_person ........................... ok
package_metadata empty position → empty_value .......................... ok
package_metadata happy path ............................................ ok
multiple participants for one role → multiple_role_assignments ......... ok
unknown context_kind → config_error .................................... ok
ok | 10 passed | 0 failed
```

## 4. Dry-run edge function

`supabase/functions/package-tokens-dry-run/index.ts`:
- Метод: POST. CORS включён.
- Auth: JWT обязателен; `has_role_v2(uid,'super_admin')=true` иначе 403.
- Rate-limit: <1 запроса в 5 секунд от того же `actor_user_id` (проверка через `audit_logs`, 429 при срабатывании).
- Input zod-like: `package_session_id uuid + alias_tokens[] (1..20)`. 400 при нарушениях.
- Вызывает `resolvePackageTokenCore` (минуя HARDCODED_ENABLED).
- **НЕ** пишет в `ai_generated_documents`, snapshot, storage; **НЕ** зовёт Gotenberg.
- Audit-row: `action='package_tokens_dry_run'`, meta = `{package_session_id, alias_tokens, alias_tokens_count, codes:{resolved/code→count}}`. Значения токенов в meta не пишутся.

## 5. UI changes

### 5.1 `useDocumentPackageSession.ts`
- `PackageParticipant.metadata: Record<string, unknown> | null` добавлено.
- `PersonAssignment.position?: string | null` добавлено.
- `participantsQuery.select` теперь читает `metadata`.
- `saveMutation` пишет `metadata = position ? {position} : {}`.
- **Risk note (delete-then-insert):** Sprint 1 уже использует этот flow для участников; Sprint 3C только добавляет одно поле в payload INSERT. Никакого расширения скоупа удаления.

### 5.2 `DocumentPackageIdeologyView.tsx`
- Whitelist `ROLES_WITH_POSITION = ['company_head','ideology_responsible']` (hardcoded, Sprint 3C only).
- Поле «Должность» (`<Input>`) под select-ом роли, рендерится только для whitelisted ролей.
- При смене роли на не-whitelisted — `personPositions[person_id]` удаляется из стейта.
- Валидация soft: при пустой должности показывается `AlertCircle + "заполните должность"`, save не блокируется.
- Hydrate из `participant.metadata.position`.

### 5.3 `PackageTokensDryRunPanel.tsx` (новый)
- Встроен **внутри** карточки «Анкета пакета» как collapsible block.
- Видим **только** для super_admin (`useSuperAdmin`).
- Чекбоксы по 4 alias-токенам, кнопка «Прогнать» → `supabase.functions.invoke('package-tokens-dry-run')`.
- Таблица результатов: `alias_token | resolved | value/code | FLD`.
- Никакой постоянной вкладки в основном `/admin/documents`.

## 6. Production safety proofs

| Проверка | Результат |
|---|---|
| `canonical-document-generate-strict` unchanged | ✅ файл не правился |
| `HARDCODED_ENABLED` = false | ✅ |
| 0 production-imports `resolvePackageTokenCore` вне dry-run/тестов | ✅ |
| `document_token_aliases` (legacy) не трогали | ✅ |
| Шаблоны / picker / billing / customer / executor резолверы не трогали | ✅ |
| Никакой реальной генерации документов | ✅ |
| Anon/authenticated grants на alias-таблице не выдавались | ✅ остаётся service_role only |
| ALTER на `fields_registry`/`document_package_token_aliases` | ✅ не выполнялись |

## 7. DoD

- [x] UI ролей `company_head`/`ideology_responsible` имеет «Должность», save пишет в `participants.metadata.position`.
- [x] Снятие роли / переключение → `metadata.position` чистится из стейта.
- [x] Deno-тесты зелёные (10/10).
- [x] Edge `package-tokens-dry-run`: super_admin gate, rate-limit 5s, audit без значений токенов, no DB writes vs business state.
- [x] `canonical-document-generate-strict` не изменён.
- [x] `HARDCODED_ENABLED = false`.
- [x] Proof-файл + memory + plan.md обновлены.

## 8. Перенесено в Sprint 3D — `Package resolver routing plan + controlled template dry-run`

Не включалось:
- routing-точка в `canonical-document-generate-strict`;
- backend-флаг `role_catalog.metadata.requires_position`;
- include `position` в обязательные required-чек;
- alias-picker UI с grant'ом для admin/editor;
- inflectRu/inflectCompanyName в `|case=` пакетных токенов.

## 9. Role key compatibility mapping (addendum, 2026-05-28)

- Alias-токены остаются generic:
    - `package.roles.company_head.{full_name,position}`
    - `package.roles.responsible_person.{full_name,position}`
- Внутри `document_package_token_aliases.role_key` для responsible_person временно хранится `'ideology_responsible'` — это **compatibility mapping** под уже созданный `document_package_role_catalog` пакета «Идеология».
- Это **НЕ** создание ideology namespace; generic `alias_token` не меняется и остаётся видимой нормой для шаблонов и резолвера.
- Запрещено:
    - создавать alias-токены вида `package.roles.ideology_responsible.*`;
    - читать `role_key='ideology_responsible'` из шаблонов/резолверов под видом нормы — только через generic `alias_token`.
- В Sprint 3D/3E принимается одно из решений:
    1. **Нормализация каталога:** переименовать `role_key` `ideology_responsible` → `responsible_person` в `document_package_role_catalog` + UPDATE alias-таблицы. Простой для шаблонов, требует миграции каталога.
    2. **Mapping-слой:** ввести колонку/таблицу `generic_role_key → package_role_key`, alias-таблица ссылается на generic. Сложнее, но без переименования живых ролей.
- До принятия решения: любая новая person-роль в каталоге обязана следовать generic-имени (`responsible_person`, не `*_responsible`).
- Рекомендуемое направление (для Sprint 3D proof): вариант 1 — нормализация. Сама миграция в Sprint 3D НЕ выполняется.
