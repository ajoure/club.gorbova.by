# да, согласен, с учетом правок:

1. **Whitelist ролей с должностью — принять hardcoded только на Sprint 3C**
  &nbsp;
  Подтвердить:
2. **Position validation — soft, не blocking**
  &nbsp;
  Подтвердить:
3. **Dev-tab dry-run лучше не делать полноценной вкладкой в** `/admin/documents`
  &nbsp;
  Чтобы не плодить служебные вкладки в нормальном UI, лучше:
  ```md
  Не добавлять постоянную вкладку в основной `/admin/documents`.

  Сделать dev-only панель:
  - либо внутри `Пакеты документов → Идеология` под collapsible block `Dev: dry-run токенов`;
  - либо через query/dev flag;
  - видимость только `super_admin`;
  - обязательно скрыть от обычных admin/editor.

  Если это сложно — можно временно добавить вкладку, но с префиксом `Dev:` и только для super_admin.
  ```
  Рекомендация: **collapsible dev-блок внутри пакета**, а не новая основная вкладка.
4. **Audit-row — да, использовать** `audit_logs`
  &nbsp;
  Подтвердить:
5. **Edge-функция dry-run — добавить rate/limit guard**
  &nbsp;
  В план добавить:
6. **Resolver core — не ломать HARDCODED_ENABLED**
  &nbsp;
  Правильно, что dry-run импортирует `resolvePackageTokenCore`. Добавить proof:
7. **UI save: delete-then-insert риск не расширять**
  &nbsp;
  Так как Sprint 1 уже использует delete-then-insert, в этом спринте можно только добавить `metadata.position` в существующий flow. Но добавить в proof:
8. **Проверить role assignment uniqueness**
  &nbsp;
  Перед dry-run добавить read-only check:
  ```sql
  SELECT package_session_id, role_key, COUNT(*)
  FROM public.document_package_session_participants
  WHERE role_key IN ('company_head','responsible_person')
  GROUP BY package_session_id, role_key
  HAVING COUNT(*) > 1;
  ```
  Если есть дубли — dry-run должен возвращать warning `multiple_role_assignments`, а не брать первого.
9. `position` **source-path должен быть один**
  &nbsp;
  Зафиксировать:
10. **Переименовать Sprint 3D**

В [plan.md](http://plan.md) следующий этап лучше назвать:

```md
Sprint 3D — Package resolver routing plan + controlled template dry-run
```

Не “generation”, потому что реальную генерацию всё еще рано включать до проверки шаблонов и token coverage.

Итог: план можно выполнять после этих правок. Выбор по открытым вопросам:

```md
1. Whitelist — hardcoded `company_head`, `responsible_person`.
2. Position — soft validation.
3. Dry-run UI — super_admin-only dev/collapsible block, не основная публичная вкладка.
4. Audit — использовать `audit_logs`, без значений токенов в meta.

План: Sprint 3C — Package Role Metadata UI + Resolver Dry-Run Integration
```

Дата: 2026-05-28
Approve-режим: только план. **Без выполнения** до отдельного approve.

## 0. Контракт-границы (hard constraints, повтор)

- Никаких изменений в `canonical-document-generate-strict`.
- Никаких изменений в шаблонах, billing/customer/executor резолверах, legacy `document_token_aliases`.
- Никакой генерации документов (Gotenberg, ai_generated_documents) и записи в snapshot/source_trace.
- `HARDCODED_ENABLED` в `resolve-package-tokens.ts` **остаётся `false**` для production-пути.
- Никаких grant-ов `anon`/`authenticated` на `document_package_token_aliases` (picker — отдельный спринт).
- Никаких ALTER на `fields_registry`, `document_package_token_aliases`.
- Никаких изменений RLS уже существующих таблиц без явного proof необходимости.

## 1. Цель спринта

1. **UI «Должность» в анкете пакета** для ролей `company_head` и `responsible_person` (+ любых будущих person-ролей с opt-in флагом) с сохранением в `document_package_session_participants.metadata.position`.
2. **Безопасный dry-run resolver test** — изолированная edge-функция `package-tokens-dry-run` (super_admin-only), которая принимает `package_session_id` + список alias-токенов и возвращает «что бы вернул resolver», **не вызывая** production-пайплайн.
3. Подтвердить end-to-end (UI → DB → resolver) для 4 alias-токенов из 3B v2.1, не включая ничего в продакшен.

---

## 2. Discovery (read-only, до изменений)

### 2.1 RLS / write-path participants

- Проверить, что authenticated-пользователь со своим `profile_id` действительно может писать `metadata` в `document_package_session_participants` (текущий `save` уже делает delete+insert этих строк → значит INSERT-policy уже покрывает участников; нужно убедиться, что колонка `metadata` существует и UPDATE/INSERT её принимает).
- SQL:
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='document_package_session_participants'
    AND column_name IN ('metadata','role_key','person_id','package_session_id');

  SELECT polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  FROM pg_policy WHERE polrelid='public.document_package_session_participants'::regclass;
  ```
- Ожидание: колонка `metadata jsonb` есть, NOT NULL DEFAULT `'{}'` (либо nullable — уточним в proof), INSERT-policy уже разрешает писать запись для своей сессии.

### 2.2 Role catalog

- Проверить `document_package_role_catalog`: какие `role_key` существуют, какие из них допускают `entity_type='person'`. Поле «Должность» включаем только для ролей, маркированных как `metadata.requires_position=true` (если такой флаг есть) **или** жёстко whitelisted в UI: `['company_head','responsible_person']`.
- SQL:
  ```sql
  SELECT id, role_key, label, allowed_entity_types, required, min_count, max_count, metadata
  FROM public.document_package_role_catalog
  WHERE is_active = true
  ORDER BY sort_order;
  ```

### 2.3 super_admin guard helper

- Подтвердить, что в `supabase/functions/_shared/` есть утилита проверки super_admin по JWT (использовать существующую, не дублировать).

---

## 3. UI работа (frontend, без backend-миграций)

### 3.1 Расширение типов и хука `useDocumentPackageSession`

`src/hooks/useDocumentPackageSession.ts`:

- Расширить `PersonAssignment`:
  ```ts
  export interface PersonAssignment {
    person_id: string;
    role_key: string;
    role_catalog_id: string | null;
    position?: string | null; // NEW: пишется в participants.metadata.position
  }
  ```
- Расширить `PackageParticipant`:
  ```ts
  export interface PackageParticipant {
    ...
    metadata: Record<string, unknown> | null; // NEW
  }
  ```
- В `participantsQuery.select` добавить `metadata`.
- В `saveMutation` при формировании `rows` для INSERT — добавить:
  ```ts
  metadata: a.position && a.position.trim().length > 0
    ? { position: a.position.trim() }
    : {},
  ```
  (Тримминг + пустая строка → `{}`, чтобы не плодить `position:''` в JSONB.)
- Контракт: участник без position сохраняется с `metadata = {}` (не NULL), чтобы alias-resolver мог однозначно отличить «не задано» от «нет участника».

### 3.2 Компонент `DocumentPackageIdeologyView.tsx`

- Локальный стейт расширить:
  ```ts
  const [personPositions, setPersonPositions] = useState<Record<string, string>>({});
  ```
- На hydrate: для каждого `p` с `entity_type==='person' && p.person_id`:
  ```ts
  const pos = (p.metadata as any)?.position;
  if (typeof pos === 'string' && pos.length > 0) personPositionsMap[p.person_id] = pos;
  ```
- Whitelist ролей, требующих должность:
  ```ts
  const ROLES_WITH_POSITION = new Set(['company_head','responsible_person']);
  ```
  (захардкодить в UI; backend-флаг — отдельный backlog).
- В существующем ряду физлица — рядом с `<Select>` роли добавить условный inline-input «Должность» (`<Input className="h-7 text-[11px] w-[160px]" placeholder="Должность">`), который рендерится только когда `ROLES_WITH_POSITION.has(currentRole)`. При смене роли на роль без позиции — `setPersonPositions` чистит запись.
- На save:
  ```ts
  const assignments: PersonAssignment[] = Object.entries(personRoles)
    .filter(([, role]) => !!role)
    .map(([person_id, role_key]) => ({
      person_id,
      role_key: role_key!,
      role_catalog_id: pkg.roleCatalog.find(r => r.role_key===role_key)?.id ?? null,
      position: ROLES_WITH_POSITION.has(role_key!) ? (personPositions[person_id] ?? '').trim() || null : null,
    }));
  ```
- UX: если роль требует position и поле пустое — показать `<AlertCircle>` рядом + label «Заполните должность» (валидация-soft, save не блокируем, но это влияет на DoD demo). **Не** включать save-блокировку для не-обязательных ролей; решение по обязательности — следующий спринт.

### 3.3 Никаких изменений

- В `canonical-document-generate-strict`, `StrictDocumentTemplatesManager`, picker-компонентах, schema-файлах — НЕ ТРОГАТЬ.

---

## 4. Resolver dry-run integration (изолированная edge-функция)

### 4.1 Новая edge-функция `supabase/functions/package-tokens-dry-run/index.ts`

Контракт:

- **Auth**: проверка JWT в коде + `has_role_v2(uid, 'super_admin')` через `_shared`-хелпер. 403 для остальных.
- **Input** (zod):
  ```ts
  { package_session_id: uuid, alias_tokens: string[] (1..20) }
  ```
- **Сервер-сайд**: использует `service_role` client.
- **Логика**:
  1. Импортирует `resolvePackageToken` из `_shared/resolve-package-tokens.ts`.
  2. Создаёт локальный «forced-on»-обёртку, **не меняя** `HARDCODED_ENABLED` в исходнике. Реализация: рефакторим `resolve-package-tokens.ts` — выносим тело `resolvePackageToken` в `resolvePackageTokenCore(input)` (без feature-флага), а внешняя функция остаётся `if(!HARDCODED_ENABLED) return FEATURE_DISABLED(); return resolvePackageTokenCore(input)`. Dry-run импортирует ТОЛЬКО `resolvePackageTokenCore`.
    - **Важно:** это не меняет публичный API resolver-а и не активирует его в production.
  3. Для каждого `alias_token` вызывает `resolvePackageTokenCore` и возвращает массив:
    ```ts
     { alias_token, resolved, value?, warning?, code?, alias_id?, canonical_field_public_id? }
    ```
- **Output**: 200 JSON, ошибки 4xx через `normalizeEdgeFunctionError`-совместимый shape (`{ error: string }`).
- **CORS**: `npm:@supabase/supabase-js@2/cors`.
- **НЕ** пишет в БД, **НЕ** трогает snapshot/source_trace/`ai_generated_documents`, **НЕ** зовёт Gotenberg.
- **Audit**: одна строка в `audit_logs` (`action='package_tokens_dry_run'`, `actor_id`=JWT uid, `meta={package_session_id, alias_tokens, results_summary}`). Никаких user-данных в audit (только статусы), чтобы не утечь person.full_name.

### 4.2 Конфиг

- `supabase/config.toml`: добавить блок только если по умолчанию `verify_jwt = true` нежелательно. Здесь нам нужен JWT — оставляем дефолт, **не** добавляем `verify_jwt = false`.

### 4.3 Frontend dev-only entry point

- В `/admin/documents` добавить **отдельный** dev-tab «Dry-run пакетных токенов» (видим только super_admin), который:
  - селект сессии пакета (из `document_package_sessions`, своих или admin override через UUID-инпут);
  - чекбокс-список 4 alias-токенов;
  - кнопка «Прогнать» → `supabase.functions.invoke('package-tokens-dry-run', {...})`;
  - таблица результатов с `resolved/value/warning/code/canonical_field_public_id`.
- НЕ показывать на других страницах, НЕ скрывать за фича-флагом в БД — гейт по `has_role` на клиенте (RBAC SOT) + 403 от функции.

---

## 5. Tests / verification

### 5.1 Deno-тест на `resolvePackageTokenCore`

- Файл: `supabase/functions/_shared/resolve-package-tokens_test.ts`.
- Кейсы (mock supabase via stub):
  1. alias_not_found → `{ resolved:false, code:'alias_missing' }`.
  2. participant_not_found → `code:'participant_missing'`.
  3. `package_person` happy path → `resolved:true, value='Иванов И.И.'`.
  4. `package_person` без person_id → `code:'no_person'`.
  5. `package_metadata` с `source_path='metadata.position'`, пустая → `code:'empty_value'`.
  6. `package_metadata` happy path → `resolved:true, value='Директор'`.
  7. unknown `context_kind` → `code:'config_error'`.

### 5.2 Frontend smoke

- Вручную:
  1. Заполнить анкету пакета: юрлицо + 1 person как `company_head` с «Директор», 1 person как `responsible_person` с «Главный бухгалтер».
  2. Сохранить. Проверить в БД, что `metadata = {"position":"Директор"}` / `{"position":"Главный бухгалтер"}`.
  3. Открыть dev-tab dry-run → прогнать 4 alias-токена → ожидание: все 4 `resolved:true`, value совпадает с UI.

### 5.3 Production regression

- `canonical-document-generate-strict` deploy-логи не меняются (функция вообще не задета).
- `HARDCODED_ENABLED` остаётся `false` → реальные template-prompts не получают новых данных.
- `audit_logs` не получает posts кроме `package_tokens_dry_run` от super_admin.

---

## 6. Артефакты

1. **Код:**
  - `src/hooks/useDocumentPackageSession.ts` — типы + save-mutation.
  - `src/components/ai-documents/DocumentPackageIdeologyView.tsx` — UI поле «Должность» + hydrate.
  - `src/pages/admin/AdminDocuments.tsx` (или эквивалентный admin entry) — dev-tab dry-run (super_admin only).
  - `src/components/admin/PackageTokensDryRunPanel.tsx` — новый компонент.
  - `supabase/functions/_shared/resolve-package-tokens.ts` — рефакторинг: выделить `resolvePackageTokenCore`, публичная `resolvePackageToken` сохраняет flag-guard.
  - `supabase/functions/_shared/resolve-package-tokens_test.ts` — Deno-тесты.
  - `supabase/functions/package-tokens-dry-run/index.ts` — новая edge-функция.
2. **Proof-файл** `.lovable/proofs/package_documents_sprint3c_execution_report_2026_05.md`:
  - discovery-результат (RLS/columns/role catalog),
  - diff по UI (скрин/строки),
  - diff resolver (выделение core),
  - вывод Deno-тестов (7/7 pass),
  - dry-run output на тестовой сессии,
  - подтверждение «`canonical-document-generate-strict` unchanged», «`HARDCODED_ENABLED=false`», «0 production imports `resolvePackageTokenCore` вне dry-run».
3. **Memory update** `mem://architecture/documents/package-token-aliases-v1`:
  - добавить раздел «UI metadata.position supported (whitelist roles: company_head, responsible_person)»;
  - добавить «Dry-run edge-функция `package-tokens-dry-run` (super_admin only, no DB writes, no generation)».
4. **plan.md** — закрыть Sprint 3C, перенести «routing-точка в `canonical-document-generate-strict` + включение flag» в Sprint 3D.

---

## 7. DoD

- UI ролей `company_head`/`responsible_person` имеет поле «Должность», save пишет в `participants.metadata.position`.
- При снятии роли или смене на роль без позиции — `metadata.position` не остаётся (стейт чистится).
- Deno-тесты `resolvePackageTokenCore` зелёные (7/7).
- Edge-функция `package-tokens-dry-run`: 403 для не-super_admin, 200 для super_admin, не пишет в snapshot/ai_generated_documents/storage, audit-row создаётся.
- На тестовой сессии 4 alias-токена резолвятся в `resolved:true` с реальными значениями из UI.
- `canonical-document-generate-strict` не изменён (git diff = 0).
- `HARDCODED_ENABLED` в публичной `resolvePackageToken` = `false`.
- `0` импортов `resolvePackageTokenCore` вне `package-tokens-dry-run/` и теста.
- Proof-файл + memory обновлены, plan.md закрывает 3C, открывает 3D-плейсхолдер.

---

## 8. Открытые вопросы для approve

1. **Whitelist ролей с позицией.** Принять hardcoded `['company_head','responsible_person']` в UI, или вынести флаг в `document_package_role_catalog.metadata.requires_position`?
  - Рекомендация: hardcoded в UI на этот спринт; backend-флаг — отдельной задачей, чтобы не растягивать 3C.
2. **Обязательность position.** Сейчас предлагается soft-валидация (save не блокируем). Подтвердить.
3. **Dev-tab dry-run.** Размещаем в `/admin/documents` как вкладку «Dev: Package tokens dry-run» — ок? Или вынести в `/admin/ai` / отдельный maintenance-роут?
4. **Audit-row.** Подтвердить, что `audit_logs` подходит (vs. отдельная `package_tokens_dry_run_log`). Рекомендация — `audit_logs` reuse.

После approve по этим 4 пунктам — выполняю Sprint 3C строго в указанных границах.