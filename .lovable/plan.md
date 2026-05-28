да, согласен, с учетом правок:

1. Все UI-labels, названия групп, кнопок, сообщений dry-run и таблиц должны быть на русском языке. Технические ключи `package.roles.*` можно показывать только в dev/debug-режиме для super_admin, но не как основные пользовательские названия.

2. Dry-run панель размещать только внутри карточки анкеты пакета как сворачиваемый dev-блок для super_admin. Не создавать отдельную основную вкладку в `/admin/documents`.

3. В Sprint 3D добавить proof-блок: где и как будут отображаться плейсхолдеры реквизитов юрлица/ИП для пакетов. Ожидаемая модель:

   - группа UI: `Пакеты документов → Компания пакета`;

   - источник: existing `legal_details` FLD;

   - путь: `package_session.selected_legal_entity_id → client_legal_details → existing legal_details FLD`;

   - новые FLD для юрлица/ИП не создавать.

4. `document_package_token_aliases` не подключать к обычному picker UI в Sprint 3D. Alias-таблица остается service_role-only. Любое отображение alias-токенов — только в super_admin dry-run dev-блоке.

5. По compatibility mapping: в proof Sprint 3D зафиксировать рекомендуемое направление — в будущем нормализовать `ideology_responsible` → `responsible_person`, но саму миграцию не выполнять в Sprint 3D.

6. В dry-run output основные названия показывать по-русски:

   - `Руководитель организации: ФИО`

   - `Руководитель организации: должность`

   - `Ответственное лицо: ФИО`

   - `Ответственное лицо: должность`

   

   Технический alias можно показывать второй строкой/в колонке `технический ключ` только для super_admin.

7. Генерацию документов, Gotenberg, `ai_generated_documents`, `canonical-document-generate-strict`, шаблоны и billing/customer/executor resolver не трогать.

&nbsp;

План: Sprint 3C closeout + Sprint 3D — Package resolver routing plan + controlled template dry-run

## 0. Hard constraints (повтор, без изменений)

- `canonical-document-generate-strict` НЕ модифицируется.
- Шаблоны, billing/customer/executor резолверы, legacy `document_token_aliases` НЕ трогаем.
- Никакой реальной генерации: Gotenberg НЕ вызывается, `ai_generated_documents` НЕ пишется.
- `HARDCODED_ENABLED` в `resolve-package-tokens.ts` остаётся `false`.
- Никаких grant'ов `anon`/`authenticated` на `document_package_token_aliases`.
- Никаких ALTER на `fields_registry`, `document_package_token_aliases`.
- Запрещено создавать alias-токены `package.roles.ideology_responsible.*` — только generic `responsible_person`.

---

## Часть A. Закрытие Sprint 3C — Role Key Compatibility Mapping

Только дополнение proof и memory. Кода не трогаем.

### A.1. Дополнить `.lovable/proofs/package_documents_sprint3c_execution_report_2026_05.md`

Добавить новую секцию «9. Role key compatibility mapping»:

```
9. Role key compatibility mapping

- Alias-токены остаются generic:
    package.roles.company_head.{full_name,position}
    package.roles.responsible_person.{full_name,position}
- Внутри `document_package_token_aliases.role_key` для responsible_person
  временно хранится 'ideology_responsible' — это compatibility mapping
  под уже созданный `document_package_role_catalog` пакета «Идеология».
- Это НЕ создание ideology namespace; generic alias_token не меняется
  и остаётся видимой нормой для шаблонов и резолвера.
- Запрещено:
    * создавать alias-токены вида `package.roles.ideology_responsible.*`;
    * читать role_key 'ideology_responsible' из шаблонов/резолверов
      под видом нормы — только через generic alias_token.
- В Sprint 3D/3E принимается одно из решений:
    (1) нормализовать каталог: переименовать role_key
        `ideology_responsible` → `responsible_person` + миграция alias-таблицы;
    (2) ввести явный mapping-слой generic_role_key → package_role_key
        (отдельная колонка или таблица), убрав фактический role_key
        пакета из alias-таблицы.
- До принятия решения: любая новая person-роль в каталоге обязана
  следовать generic-имени (`responsible_person`, не `*_responsible`).
```

### A.2. Обновить `mem://architecture/documents/package-token-aliases-v1`

Добавить блок «Role Key Compatibility Mapping (Sprint 3C addendum)» с теми же 4 пунктами + ссылкой на addendum proof. Index обновить только если меняется one-liner; иначе оставить как есть.

### A.3. Обновить `.lovable/plan.md`

В разделе «Sprint 3C — COMPLETED» добавить пункт:

- Compatibility mapping `role_key='ideology_responsible'` зафиксирован как временный adapter; решение о нормализации — в Sprint 3D/3E.

### A.4. DoD части A

- Proof 3C содержит секцию «9. Role key compatibility mapping» с полным текстом из A.1.
- Memory `package-token-aliases-v1` содержит compatibility-блок.
- `plan.md` обновлён.
- Никаких изменений в коде, БД, edge-функциях.

---

## Часть B. Sprint 3D — Package resolver routing plan + controlled template dry-run

Цель: один тестовый шаблон прогнать через резолвер пакетных токенов в режиме dry-run, собрать coverage report. Реальной генерации нет.

### B.1. Discovery (read-only)

1. Найти один кандидат-шаблон под пакет «Идеология»:
  - `document_templates` + `document_template_versions` (active version) с пакетными токенами `package.roles.*`.
  - Если ни один шаблон ещё не содержит пакетных токенов — выбрать тестовый template_id и временно (для dry-run only) использовать тестовую строку шаблона из БД без модификации production-версии.
2. Извлечь полный список токенов первого активного приказа: какие `{{field:FLD-...}}`, какие `package.roles.*`, какие customer/executor/billing.
3. Подтвердить, что `canonical-document-generate-strict` не имеет ни одной точки импорта `resolvePackageToken` (повторный grep).

### B.2. Edge-функция `package-template-dry-run` (новая, super_admin only)

Назначение: симулировать рендер ОДНОГО шаблона на ОДНОЙ package_session_id и вернуть coverage без записи и без Gotenberg.

Контракт:

- POST, JWT обязателен, `has_role_v2(uid,'super_admin')=true` иначе 403.
- Rate-limit 1 запрос / 5 секунд по actor_user_id (по образцу `package-tokens-dry-run`).
- Input: `{ package_session_id: uuid, template_id: uuid, template_version_id?: uuid }`. Без template_version_id берётся текущая active.
- Логика:
  1. Загрузить тело шаблона (read-only).
  2. Извлечь все токены (используем уже существующий tokenizer из shared, если есть; иначе read-only regex без записи в БД).
  3. Для каждого токена:
    - `package.roles.*` → `resolvePackageTokenCore` (минуя HARDCODED_ENABLED, это dry-run).
    - НЕ package-токены → НЕ резолвим в этом спринте; помечаем как `out_of_scope_3d` (чтобы не дёргать customer/executor/billing).
  4. Никаких записей в `ai_generated_documents`, `document_render_snapshots`, storage. Никакого вызова Gotenberg.
- Output:
  ```
  {
    template_id, template_version_id,
    tokens_total, tokens_package, tokens_out_of_scope,
    coverage: [
      { raw_token, kind: 'package'|'out_of_scope',
        resolved?: boolean, code?, warning?,
        alias_id?, canonical_field_public_id?, role_key? }
    ],
    summary: { resolved, unresolved, by_code: { code → count } }
  }
  ```
  Значения токенов в response — ТОЛЬКО для `package.*` и ТОЛЬКО если resolved=true. Customer/executor/billing значения не возвращаются.
- Audit-row: `action='package_template_dry_run'`, meta = `{package_session_id, template_id, template_version_id, tokens_total, tokens_package, summary.by_code}`. Значения токенов в meta НЕ пишутся.

### B.3. UI: расширить `PackageTokensDryRunPanel.tsx`

В уже существующем collapsible-блоке (super_admin only) добавить вторую секцию «Dry-run шаблона»:

- Select шаблона (только те, у которых есть `package.roles.*` токены; иначе показывать пустой список + подсказку).
- Кнопка «Прогнать шаблон» → `supabase.functions.invoke('package-template-dry-run')`.
- Результат:
  - Top-bar: `tokens_total / package / out_of_scope`, `resolved / unresolved`, разбивка by_code.
  - Таблица токенов: `raw_token | kind | resolved | code/warning | alias_id | FLD`.
- Никаких изменений в основном `/admin/documents`.

### B.4. Deno-тесты

Новый файл `supabase/functions/package-template-dry-run/_test.ts`:

1. 403 без super_admin.
2. 429 при повторном вызове <5s.
3. Шаблон без `package.roles.*` → `tokens_package=0`, `out_of_scope` = все остальные.
4. Шаблон с 4 alias-токенами на пустой сессии → 4 unresolved (`participant_missing`/`alias_missing`/`empty_value`).
5. Шаблон с 4 alias-токенами на заполненной сессии (фикстура с `company_head` + `ideology_responsible` + metadata.position) → 4 resolved.
6. Шаблон с участником, у которого `person_id=null` → `no_person` для person-токенов.
7. Шаблон с двумя участниками одной роли → `multiple_role_assignments`.

Цель: гарантировать, что dry-run не зависит от HARDCODED_ENABLED и не задевает production-путь.

### B.5. Решение по compatibility mapping (часть, не выполнение)

В рамках Sprint 3D ТОЛЬКО зафиксировать выбор (без миграции):

- Вариант 1: переименовать `ideology_responsible` → `responsible_person` в `document_package_role_catalog` + UPDATE alias-таблицы. Проще для шаблонов, но требует миграции каталога.
- Вариант 2: ввести колонку `document_package_role_catalog.generic_role_key` (или таблицу mapping), alias-таблица ссылается на generic. Сложнее, но без переименования живых ролей.

Документировать выбор в proof Sprint 3D. Сама миграция — Sprint 3E.

### B.6. Production safety proofs (повтор, обязателен к закрытию)


| Проверка                                                                | Ожидание                  |
| ----------------------------------------------------------------------- | ------------------------- |
| `canonical-document-generate-strict` unchanged                          | git-diff пустой           |
| `HARDCODED_ENABLED` = false                                             | подтверждено grep         |
| 0 production-imports `resolvePackageTokenCore` вне dry-run/тестов       | подтверждено rg           |
| `document_token_aliases` (legacy) не трогали                            | подтверждено rg           |
| Шаблоны / picker / billing / customer / executor резолверы не правились | git-diff                  |
| Никакой реальной генерации (Gotenberg, ai_generated_documents)          | проверено по логам тестов |
| Anon/authenticated grants на alias-таблице не выдавались                | check pg_grants           |
| ALTER на `fields_registry`/`document_package_token_aliases`             | git-diff миграций пуст    |
| Новых alias-токенов `package.roles.ideology_responsible.*` не создано   | rg по миграциям           |


### B.7. DoD Sprint 3D

- Edge `package-template-dry-run` задеплоена, super_admin gate, rate-limit 5s, no DB writes vs business state, no Gotenberg.
- UI: внутри уже существующего dev-блока (super_admin only) появилась секция «Dry-run шаблона» с coverage report.
- Deno-тесты 7/7 зелёные.
- Proof Sprint 3D зафиксировал выбор стратегии нормализации (вариант 1 или 2), но миграции НЕ выполнял.
- Memory `package-token-aliases-v1` обновлён ссылкой на Sprint 3D и выбранную стратегию.
- Все пункты B.6 закрыты.

### B.8. Явно отложено в Sprint 3E

- Реальная генерация документа пакета (включение routing-точки в `canonical-document-generate-strict` за БД-флагом).
- Backend-флаг `document_package_role_catalog.metadata.requires_position` (замена UI hardcode).
- Миграция нормализации `ideology_responsible` → `responsible_person` (или ввод generic_role_key).
- `|case=` через `inflectRu/inflectCompanyName` в пакетных токенах.
- Alias-picker UI для admin с grant'ом на чтение `document_package_token_aliases`.

---

## Порядок выполнения после approve

1. Часть A целиком (3 файла, без кода/БД).
2. Часть B по шагам B.1 → B.2 → B.3 → B.4 → B.5 → B.6 → B.7.
3. Между B.1 и B.2 — короткий промежуточный отчёт о выбранном тестовом шаблоне (для подтверждения).