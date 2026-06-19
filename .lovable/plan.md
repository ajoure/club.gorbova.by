да, согласен, с учетом правок:

1. **Название режима лучше оставить единым с ранее утверждённой терминологией.**  
Сейчас в плане указано:
  &nbsp;
  ```text
  generation_mode IN ('single','per_role')
  ```
  Ранее мы называли режим:
  ```text
  per_role_person
  ```
  Чтобы смысл был однозначный, лучше использовать:
  ```text
  single
  per_role_person
  ```
  `per_role` слишком общий: потом может быть генерация по роли юрлица, по группе, по подписанту и т.п.
2. **В Stage A не добавлять генераторную семантику в код, но сразу заложить точное название колонок.**
  &nbsp;
  Итоговая схема:
3. **Триггер должен проверять не только пакет, но и активность роли.**
  &nbsp;
  При `generation_mode='per_role_person'`:
  - `repeat_role_catalog_id IS NOT NULL`;
  - роль существует;
  - `role.package_template_id = item.package_template_id`;
  - если в `document_package_role_catalog` есть `is_active`, роль должна быть активной.
  При `generation_mode='single'`:
  - `repeat_role_catalog_id IS NULL`.
4. **UI при переключении обратно в** `single` **обязан очищать** `repeat_role_catalog_id`**.**
  &nbsp;
  Нельзя оставлять скрытое значение роли при режиме `single`, иначе потом генератор или UI могут ошибочно интерпретировать item как частично настроенный repeat-документ.
5. **В списке ролей показывать только роли текущего package template.**
  &nbsp;
  Не брать роли из session assignments и не брать роли других пакетов. Источник для select:
6. **UI должен поддерживать сценарий “сначала шаблон, потом роль”.**
  &nbsp;
  Если ролей ещё нет:
  - режим `per_role_person` можно показать disabled;
  - рядом текст:
  ```text
  Сначала добавьте роль пакета, затем выберите её как источник повторения.
  ```
  После создания роли item можно открыть и выбрать её без пересоздания документа.
7. **Сохранение item-настроек должно быть audit-able.**
  Если в проекте уже есть audit для изменения `document_package_template_items`, использовать его. Если нет — хотя бы в proof показать SQL before/after. Новый audit-механизм в Stage A не создавать.
8. **RLS/права проверить отдельно.**
  В DoD добавить:
  - super_admin/admin может изменить `generation_mode`;
  - обычный клиент не может менять template item settings;
  - клиентская анкета только читает этот режим.
9. **Не использовать** `document_package_session_participants` **как источник repeat-получателей.**
  &nbsp;
  Правильно, что он указан как session-level. В proof отдельно зафиксировать:
10. **В Stage A proof добавить проверку обратимости.**

Проверить:

```text
single/null
→ per_role_person + uchastnik
→ single/null
```

После возврата в `single` в БД должно быть:

```text
generation_mode = 'single'
repeat_role_catalog_id IS NULL
```

11. **Не утверждать “нулевой regression risk”, лучше “минимальный regression risk”.**

Схема add-only, но типы Supabase и UI могут затронуть места, где item ожидается старой формы. Поэтому обязательны:

- `typecheck`;
- поиск мест использования `document_package_template_items`;
- smoke открытия существующих пакетов.

12. **Stage A не должен блокировать текущую генерацию.**

После миграции, но до Stage B/C:

- все существующие item имеют `single`;
- текущий генератор игнорирует новые поля;
- пакет «Годовое собрание» генерируется как раньше.

Это нужно явно проверить.

13. **В proof добавить список изменённых файлов.**

Минимум:

```text
migration file
PackageAdminPanel / item settings component
Supabase generated types
proof file
```

После этих правок Stage A можно выполнять.

&nbsp;

План: PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 — Stage A (Discovery + Schema)

## 1. Проблема

Документы пакета («Извещение», «Доверенность» и т.п.) сейчас генерируются строго 1 раз на item. Бизнес-сценарий «Годовое собрание» требует, чтобы один и тот же template_item раскрывался в N экземпляров по числу назначений конкретной роли (например, по каждому «Участнику» — отдельное извещение). На текущей схеме это невозможно: нет ни признака режима генерации у item, ни ссылки на роль-источник повторения, ни recipient-контекста.

## 2. Диагностика (factual)

Проверено через information_schema и БД:

- `document_package_template_items` (7 колонок): `id, package_template_id, template_id, sort_order, is_required, title_override, created_at`. Полей `metadata`, `generation_mode`, `repeat_role_catalog_id` НЕТ.
- `document_package_role_catalog` существует, ключ — `id` (UUID), скоуп — `package_template_id`. Для пакета «Годовое собрание» уже заведены роли `revizor`, `uchastnik`.
- `document_package_item_role_assignments` существует, хранит desired-state ролей per item (`package_session_id`, `package_template_item_id`, `role_catalog_id`, `person_id`, `is_active`, `sort_order`, `metadata`). Stage 5 подтвердил контракт `save_session_document_atomic`.
- `document_package_session_participants` — session-level участники (`role_key`, `role_catalog_id`, `person_id/legal_entity_id`). Это session-scope, не item-scope.
- `ai_generated_documents` — единственный SoT сгенерированных файлов (Document File Name Template / Sprint 3K / 3H-fix уже на этой таблице).

Дублей generation_mode/repeat_* в schema, RPC, edge functions и UI не найдено (`rg` по проекту).

## 3. Предлагаемое решение (только Stage A)

Stage A покрывает ТОЛЬКО Discovery + Schema. Recipient-resolver, генератор и retro-fix — отдельные стадии этого же PATCH (B/C/D), они описаны ниже только как scope-references, кода в Stage A не меняем.

### 3.1. Миграция (schema-only, add-only)

Добавить к `document_package_template_items` две колонки:

- `generation_mode text NOT NULL DEFAULT 'single'` с CHECK `generation_mode IN ('single','per_role')`.
- `repeat_role_catalog_id uuid NULL` с FK → `document_package_role_catalog(id) ON DELETE RESTRICT`.

Constraint целостности (триггер, не CHECK — ссылается на другую таблицу):

- При `generation_mode='per_role'`: `repeat_role_catalog_id` обязателен и должен принадлежать тому же `package_template_id`, что и item.
- При `generation_mode='single'`: `repeat_role_catalog_id` должен быть `NULL`.

Существующие 100% строк остаются `'single' + NULL` — поведение не меняется. Никаких backfill.

### 3.2. UI-настройка у уже добавленного документа пакета

Точка входа: админка пакета (`PackageAdminPanel` / редактирование item-а template).

- Добавить в форму item-а селектор «Режим генерации»: «Один документ» (single) / «По одному на роль» (per_role).
- При выборе `per_role` появляется обязательный селектор «Роль-источник повторения» — список из `document_package_role_catalog` по текущему `package_template_id` (только `is_active=true`).
- Сабмит обновляет ровно эти 2 колонки через существующий update-канал items.
- Read-only визуализация в списке item-ов: badge `× по роли «<label>»` для per_role.

### 3.3. Что НЕ делаем в Stage A

- Не трогаем `save_session_document_atomic` (Stage 5 PASS).
- Не меняем `document_package_session_field_values`, `document_package_item_role_assignments` — их схема уже совместима.
- Не реализуем recipient-resolver, генератор N документов, ретро-генерацию по уже сохранённым ассайнментам, маркап шаблонов с recipient-токенами — это Stage B/C/D.
- Не плодим новых таблиц/RPC/enum (соблюдено правило 9/15 ENGINEERING_RULES).

## 4. Изменяемые компоненты

Миграция:

- `public.document_package_template_items` (+2 колонки, +1 trigger для cross-table constraint).

Code (UI only):

- `src/components/ai-documents/packages/PackageAdminPanel.tsx` (или дочерняя форма item-а — уточняется при чтении файла перед Stage A.execute).
- `src/integrations/supabase/types.ts` — auto-regen после миграции.

Edge functions: нет.
RPC: нет.
Cron: нет.

## 5. Что не будет изменено

- `save_session_document_atomic` и его контракт.
- Структура и поведение `document_package_item_role_assignments`, `document_package_session_field_values`.
- Текущий `single`-флоу генерации (`ai-generate-document-package`, `canonical-document-generate-strict`) до Stage C.
- Document File Name Template (Sprint 3K), package token aliases (3D), per-document questionnaires (3G/3H-fix) — все остаются как есть.

## 6. Dry-run

1. `SELECT count(*) FROM document_package_template_items;` — фиксируем N.
2. На staging-копии (или в транзакции с ROLLBACK через psql) выполнить миграцию, проверить:
  - все строки получили `generation_mode='single'`, `repeat_role_catalog_id IS NULL`;
  - попытка `UPDATE ... SET generation_mode='per_role'` без `repeat_role_catalog_id` → trigger error;
  - попытка указать `repeat_role_catalog_id` из чужого пакета → trigger error;
  - попытка `single + repeat_role_catalog_id NOT NULL` → trigger error.
3. UI: открыть item «1. Приказ…» пакета «Годовое собрание», переключить в `per_role` → выбрать роль `uchastnik` → сохранить → перечитать → проверить, что значение сохранилось; вернуть обратно в `single` (контроль обратимости).

## 7. Execute

1. Применить миграцию через `supabase--migration` (add column + check + FK + trigger). После approve регенерируется types.
2. Доработать UI item-формы (только React, без бизнес-логики генерации).
3. Smoke: открыть `/admin/documents`, проверить отображение badge у переключённого item-а и отсутствие регрессии в существующих single-item.

## 8. STOP-guards

- Найдено существующее поле/флаг с эквивалентным смыслом (`metadata.generation_mode`, кастомный JSONB-флаг и т.п.) — остановиться, переиспользовать.
- `document_package_template_items` оказывается партиционирована/имеет триггеры, ломающиеся от ALTER — остановиться, переоформить.
- В коде обнаруживается активный consumer, ожидающий ровно 7 колонок (например, явный SELECT-list или generated types, ломающие сборку) — зафиксировать и поправить точечно.
- На staging dry-run миграция фейлится или меняет >0 существующих строк по факту — откат, новый план.

## 9. DoD

- В `document_package_template_items` присутствуют `generation_mode` (NOT NULL DEFAULT 'single', CHECK) и `repeat_role_catalog_id` (NULL, FK).
- Триггер cross-table consistency активен и покрыт 3 negative-тестами (см. dry-run).
- Все существующие items имеют `single`/`NULL`; ни один существующий генератор/UI-флоу не меняет поведение.
- В админке пакета можно у конкретного item включить `per_role` и выбрать роль из каталога этого пакета; значение читается обратно без рефреша.
- Никаких новых RPC/edge functions/cron/enum/таблиц не создано.
- Proof-файл `.lovable/proofs/package_repeatable_documents_schema_v1.md`: миграция, SQL до/после, 3 negative-теста, UI-скрин/описание.

## 10. Риски и зависимости

- Регенерация `src/integrations/supabase/types.ts` после миграции — может потребоваться обновление мест, где тип item-а используется как литерал (низкий риск, add-only).
- UI item-формы может быть размазана между несколькими компонентами — перед `execute` обязательно прочитать `PackageAdminPanel.tsx` и связанные диалоги (`TemplateBindingControl.tsx` и пр.) и выбрать единственную точку.
- Recipient-resolver и генератор (Stage B/C) спроектированы так, чтобы читать новые колонки и НЕ зависеть от старого поведения single — но это валидируется на их собственных стадиях.

## 11. Stage B/C/D (scope-reference, НЕ часть Stage A)

- **B. Recipient context**: shared helper `resolvePerRoleRecipients(session_id, item_id)` → массив `{ role_assignment_id, person_id, sort_order }` из активных `document_package_item_role_assignments` по `repeat_role_catalog_id` item-а. Только чтение.
- **C. Generator**: расширить `ai-generate-document-package` (и канонический `canonical-document-generate-strict`-вызов) ветвью `per_role`: для каждого recipient — отдельный `ai_generated_documents` с `meta.recipient.role_assignment_id`, snapshot `file_name_template`. Один item → N документов, идемпотентно по `(session_id, item_id, role_assignment_id)`.
- **D. Retro**: при изменении desired-state ассайнментов per_role item-а — пересинхронизировать набор документов (новые → generate, удалённые → archive, без удаления файлов), всё через canonical write-path.

Каждая из B/C/D оформляется отдельным планом «PATCH ... Stage B/…» после PASS текущего Stage A.