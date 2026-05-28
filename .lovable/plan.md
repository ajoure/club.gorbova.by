# Да, согласен, с учетом правок:

Главная модель теперь правильная: роль в пакете = отдельная сущность с `PKR-XXXXXX`, placeholder в Word один: `{{package.role.PKR-000001}}`. Название роли можно менять, но placeholder не ломается.

Нужно внести правки перед approve.

да, согласен, с учетом правок:

1. В Phase 2 сохранить единственный канонический формат роли:

```text
{{package.role.PKR-XXXXXX}}
```

Запрещено возвращаться к форматам:

```text
{{package.roles.<role_key>.<attr>}}
{{package.roles.<role_key>.full_name}}
{{package.roles.<role_key>.position}}
{{package.roles.<role_key>.short_name}}
```

Старый формат может оставаться только как deprecated warning для уже существующих старых токенов, но в UI, picker, каталоге и новых DOCX показывать только `{{package.role.PKR-XXXXXX}}`.

2. Не создавать `full_name`, `short_name`, `position` как отдельные role-токены.

Один PKR-token должен сам подставлять итоговое значение роли по правилу `output_template`.

Пример:

```text
{{package.role.PKR-000001}}
```

А что именно попадёт в документ, определяется настройкой роли:

```text
{{position}}, {{full_name}}
```

или

```text
{{position}}, {{short_name}}
```

или

```text
{{full_name}}
```

То есть `output_template` — это настройка роли, а не часть placeholder в Word.

3. `PKR-XXXXXX` должен быть стабильным ID роли.

Если администратор переименовал роль с «Ответственный за идеологическую работу» на «Ответственное лицо», placeholder в DOCX не должен меняться и не должен ломаться.

Связь должна быть:

```text
document_package_role_catalog.public_id = PKR-XXXXXX
document_package_session_participants.role_catalog_id = id роли
DOCX token = {{package.role.PKR-XXXXXX}}
```

Не использовать русское название роли, `role_key` или slug как источник связи для DOCX.

4. Роли должны быть строго per-package.

Одна роль принадлежит конкретному `package_template_id`.

Одинаковые по названию роли в разных пакетах должны иметь разные PKR.

Пример:

```text
Пакет «Идеология»:
PKR-000001 = Ответственный за идеологическую работу

Пакет «Ответ по балансу»:
PKR-000025 = Ответственный за подготовку ответа
```

Даже если название одинаковое, это разные роли, разные PKR и разные назначения физлиц.

5. В `document_package_session_participants` нельзя хранить связь только по `role_key`.

Нужно использовать `role_catalog_id` как основную связь с ролью.

`role_key` можно оставить как технический/legacy fallback, но SOT должен быть:

```text
package_session_id + role_catalog_id + person_id + metadata
```

Иначе при переименовании или изменении `role_key` может сломаться связь.

6. В `document_package_role_catalog` добавить/проверить поля:

```text
public_id = PKR-XXXXXX
package_template_id
label_ru
role_key
is_system
is_active
output_template
sort_order
required
min_count
max_count
metadata
```

`public_id` нельзя менять после создания.

7. Для custom roles не нужен ручной `role_key` в UI.

Администратор должен вводить только русское название роли.

Система сама создаёт технический `role_key` и `PKR`.

В UI можно показывать `role_key` только super_admin в debug-режиме. Обычному администратору он не нужен.

8. В UI «Пакеты документов → Роли пакета» сделать:

- список ролей конкретного пакета;
- кнопка «Добавить роль»;
- поле «Название роли»;
- поле «Как выводить в документе» / `output_template`;
- подсказка доступных переменных:
  - `{{full_name}}`
  - `{{short_name}}`
  - `{{position}}`
- PKR показывать как копируемый placeholder:
  - `{{package.role.PKR-XXXXXX}}`

9. В анкете пакета dropdown ролей должен читать только активные роли текущего пакета:

```sql
document_package_role_catalog
WHERE package_template_id = current_package_template_id
AND is_active = true
```

Никакого хардкода ролей.

10. При создании новой роли она должна автоматически появиться:

- в настройках пакета;
- в dropdown анкеты пакета;
- в группе плейсхолдеров «Пакет: Роли»;
- как копируемый placeholder `{{package.role.PKR-XXXXXX}}`.

11. В группе «Пакет: Роли» показывать роли с группировкой по пакету.

Пример UI:

```text
Пакет: Роли
  Идеология
    Ответственный за идеологическую работу — {{package.role.PKR-000003}}
    Подписант документов — {{package.role.PKR-000004}}

  Ответ по балансу
    Ответственный за подготовку — {{package.role.PKR-000025}}
```

Все labels — на русском. Технические ключи — только debug для super_admin.

12. Удаление роли — только soft archive:

```text
is_active=false
```

Hard delete запретить и в UI, и на уровне БД trigger/RLS.

Если роль уже использовалась в DOCX, старый PKR должен остаться в системе, чтобы validator мог показать понятное предупреждение, а не сломаться молча.

13. Для `is_system=true` запретить менять:

- `public_id`;
- `package_template_id`;
- `role_key`;
- `is_system`.

Разрешить менять:

- русское название;
- описание;
- сортировку;
- required/min/max;
- active/inactive;
- output_template.

14. Validator должен принимать:

```text
{{package.role.PKR-XXXXXX}}
{{package.ul.FLD-XXXXXX}}
{{package.ip.FLD-XXXXXX}}
{{package.fl.FLD-XXXXXX}}
{{field:FLD-XXXXXX}}
```

В package template системные/документные `{{field:FLD-...}}` допустимы.

Примеры допустимых:

```text
{{field:FLD-000069}}
{{field:FLD-000209}}
{{field:FLD-000211}}
```

15. В package template биллинговые реквизиты заказчика/исполнителя через `{{field:FLD-...}}` не блокировать ошибкой, а показывать warning:

```text
Этот плейсхолдер относится к биллинговым реквизитам. Для реквизитов пакета используйте группы «Пакет: ЮЛ», «Пакет: ИП», «Пакет: ФЛ».
```

16. В billing template `package.*` должен быть error.

Package placeholders не должны использоваться в биллинговых актах.

17. Template-to-package binding делать через `document_package_template_items`.

В шаблоне добавить выбор:

```text
Тип шаблона:
- Биллинговый документ
- Пакет документов
```

Если выбран «Пакет документов» — выбрать конкретный пакет и привязать шаблон.

18. Привязка/отвязка шаблонов к пакету — только admin/super_admin.

Если direct frontend INSERT небезопасен — сделать admin-only RPC/edge action:

```text
package_template_bind_template
package_template_unbind_template
```

с записью в `audit_logs`.

19. Controlled validation panel должен работать без генерации.

Запрещено:

- Gotenberg;
- запись в `ai_generated_documents`;
- вызов `canonical-document-generate-strict`;
- snapshot/source_trace write.

Только чтение DOCX, извлечение токенов и проверка valid/warning/error.

20. Proof Phase 2 обязательно должен показать:

- создание custom-роли и присвоение PKR;
- изменение названия роли без изменения PKR;
- появление роли в dropdown анкеты;
- появление роли в каталоге «Пакет: Роли»;
- копирование `{{package.role.PKR-XXXXXX}}`;
- привязку DOCX-приказа к пакету «Идеология»;
- validation report по DOCX;
- audit_logs по созданию/изменению роли и привязке шаблона;
- подтверждение, что `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing resolver не тронуты.

21. Billing regression proof обязателен:

- группы «Заказчик ЮЛ / ИП / ФЛ» и «Исполнитель ЮЛ» не изменились;
- биллинговые шаблоны открываются как раньше;
- `package.*` в billing template даёт error;
- `{{field:FLD-...}}` в billing template работает как раньше.

Финальная цель Phase 2:

```text
completed: package roles are PKR-based, per-package, rename-safe, visible in picker, assignable in questionnaire, and usable in DOCX via one stable token {{package.role.PKR-XXXXXX}}; template-to-package binding and controlled validation implemented; generation remains deferred.

План: Sprint 3F Phase 2 — UI ролей + анкета + binding + controlled validation
```

Diagnose → Plan → (Dry run) → Execute → Verify. Согласно ENGINEERING_RULES.

## 0. Жёсткие инварианты (не нарушать)

- Канонический формат роли — только `{{package.role.PKR-XXXXXX}}`. Старый `{{package.roles.<role_key>.<attr>}}` — read-only deprecated warning, в UI каталога и picker'ах **не показывать**.
- `document_package_role_catalog` — per-package (FK `package_template_id`). Глобальных ролей нет; одинаковое название в разных пакетах → разные PKR.
- `is_system=true`: нельзя удалять физически, нельзя менять `public_id`, нельзя менять `role_key` (техническая связь). Разрешено менять только: `label_ru`, `description`, `sort_order`, `required`, `min_count`, `max_count`, `is_active`, `output_template`.
- Удаление любой роли (system или custom) — только soft (`is_active=false`). Hard delete запрещён UI.
- Реквизиты ЮЛ/ИП/ФЛ пакета — только `{{package.ul|ip|fl.FLD-XXXXXX}}`. `{{field:FLD-...}}` из billing-групп в package template → warning, не error.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing-резолвер — НЕ ТРОГАТЬ. Controlled validation работает на чтение DOCX без записи и без генерации.
- Привязка шаблонов к пакетам — только через `document_package_template_items`. CRUD доступен только admin/super_admin (проверка через `has_role_v2`); RLS уже строгий — если direct INSERT недоступен обычному пользователю, делаем admin-only edge action с `audit_logs`.

## 1. Backend: миграция

Файл: `supabase/migrations/<ts>_sprint3f_phase2_role_crud_guards.sql`

1.1. Триггер защиты `document_package_role_catalog`:

- `BEFORE UPDATE`: если `OLD.is_system=true` — запретить менять `public_id`, `role_key`, `is_system`, `package_template_id`. Разрешить остальное.
- `BEFORE DELETE`: если `is_system=true` — RAISE EXCEPTION. Для остальных тоже блокируем hard delete (политика — soft only); UI делает `UPDATE … SET is_active=false`.

1.2. Уникальный индекс `(package_template_id, role_key)` — гарантирует per-package уникальность; одинаковые role_key в разных пакетах допустимы.

1.3. RLS на `document_package_role_catalog`:

- SELECT — authenticated (нужен для dropdown анкеты).
- INSERT/UPDATE/DELETE — только `has_role_v2(auth.uid(),'super_admin'|'admin')`.
- Триггер `audit_role_catalog_change` → `audit_logs` (actor = `auth.uid()`).

1.4. RLS на `document_package_template_items` — INSERT/DELETE/UPDATE только admin/super_admin. Триггер audit на link/unlink.

1.5. `document_templates.template_scope` уже существует (text). Добавить CHECK: `template_scope IN ('billing','package',NULL)`. Триггер: при INSERT/DELETE в `document_package_template_items` синхронизировать `template_scope` соответствующего шаблона (denormalized hint).

## 2. Frontend: UI CRUD ролей per-package

Новый компонент `src/components/ai-documents/packages/PackageRolesManager.tsx` — встраивается в существующий редактор пакета (там, где сейчас список items). Колонки:

- `public_id` (PKR-XXXXXX, моно, read-only)
- `label_ru` (editable)
- `role_key` (read-only для is_system; editable для custom, формат `^[a-z][a-z0-9_]*$`)
- `is_system` (badge «Системная»)
- `required`, `min_count`, `max_count`, `sort_order`, `is_active`
- `output_template` (с подсказкой `{{full_name}} / {{short_name}} / {{position}}`)

Действия:

- «Добавить роль» — открывает диалог; при INSERT триггер `assign_package_role_public_id` выдаёт PKR.
- «Архивировать» — `is_active=false` (вместо DELETE). Для system-ролей кнопка «Удалить» отсутствует.
- Drag-reorder `sort_order` (опционально, в этой фазе — числовое поле).

Хук: `src/hooks/usePackageRoleCatalog.ts` — `useQuery` по `package_template_id`, мутации create/update/archive с invalidate.

## 3. Анкета пакета — dropdown ролей из БД

Файл с анкетой (определить через grep `document_package_session_participants`). Заменить любой хардкод массива ролей на чтение `document_package_role_catalog` где `package_template_id = session.package_template_id AND is_active = true`, сортировка по `sort_order`. Dropdown показывает `label_ru`, value — `role_key`.

## 4. Каталог плейсхолдеров «Пакет: Роли»

`PlaceholdersCatalogTab.tsx` уже фетчит роли (Phase 1). Уточнения:

- Показывать только активные роли выбранного пакета (если в каталоге есть селектор пакета — использовать его; если глобальный режим — группировать по пакету).
- Copy-token — только `{{package.role.PKR-XXXXXX}}`. Никаких `.full_name/.position/.short_name` вариантов.
- Скрыть из UI всё, что приходит из `document_package_token_aliases` (Sprint 3B legacy) — остаётся только в validator как deprecated warning.

## 5. Template-to-package binding UI

В редакторе шаблона (`StrictDocumentTemplatesManager.tsx` или соседний `TemplateEditor`):

- Radio: «Биллинговый документ» / «Пакет документов».
- При выборе «Пакет документов» — селект пакета и кнопка «Привязать к пакету» → INSERT в `document_package_template_items` через admin-only RPC `package_template_bind_template(template_id, package_template_id)`. RPC проверяет роль, делает upsert, обновляет `template_scope='package'`, пишет audit.
- Кнопка «Отвязать» → `package_template_unbind_template`, `template_scope` сбрасывается, audit.
- Для non-admin — кнопки disabled с подсказкой.

## 6. Controlled validation panel

Новый компонент `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx`. Открывается из карточки шаблона/пакета. Шаги:

1. Загружает текущую активную версию DOCX (по `template_versions` или storage путь) — **только GET**.
2. Локальный парсинг через уже существующий `src/utils/extractDocxPlaceholders.ts`.
3. Прогоняет каждый токен через те же правила, что в `canonical-template-apply-markup` (regex таблица из Phase 1) — клиентский mirror, без вызова edge.
4. Дополнительная проверка scope для package-templates:
  - `{{field:FLD-XXXXXX}}` ∈ системных/документных (FLD-000069, 209, 211 + список из `fields_registry` с признаком `is_system`/`is_document`) → **valid**.
  - `{{field:FLD-XXXXXX}}` ∈ billing-групп («Заказчик ЮЛ/ИП/ФЛ», «Исполнитель ЮЛ») → **warning** `billing_token_in_package_template_warning`.
  - `{{package.ul|ip|fl.FLD-XXXXXX}}` → valid; проверка существования FLD в `fields_registry`.
  - `{{package.role.PKR-XXXXXX}}` → valid; PKR должен принадлежать привязанному package_template_id (иначе error `pkr_outside_bound_package`).
  - `{{package.roles.<role_key>.*}}` → warning deprecated.
5. Рендер таблицы: токен / статус (valid/warning/error) / сообщение. Нет ни одной мутации, никаких вызовов Gotenberg/generate-strict/ai_generated_documents.

## 7. Proof + memory

- `.lovable/proofs/package_documents_sprint3f_phase2_2026_05.md`:
  - скриншоты/описание UI CRUD ролей; create custom-role → PKR-XXXXXX; роль в dropdown анкеты; роль в каталоге; bind DOCX к пакету «Идеология»; validation report.
  - SQL-выборки `audit_logs` по обоим действиям.
  - grep-доказательство, что `canonical-document-generate-strict`, Gotenberg-вызовы, `ai_generated_documents`-INSERT не модифицированы.
  - Billing regression: открыть billing-шаблон, прогнать validator — `package.*` → error, billing FLD → valid; группы «Заказчик/Исполнитель» в каталоге не изменены (diff `src/utils/legalDetailsFieldsCatalog.ts` либо аналога — пусто).
- Обновить `mem://architecture/documents/package-token-aliases-v1` (Phase 2 секция: per-package CRUD, system guards, controlled validation rules).

## 8. DoD

- Миграция: триггеры защиты system-ролей, audit, RLS admin-only на binding.
- UI per-package roles CRUD (create / edit safe fields / archive); system-роли защищены в UI и в БД.
- Анкета читает роли из `document_package_role_catalog`, без хардкода.
- Каталог показывает только PKR-токены активных ролей нужного пакета.
- Bind/unbind шаблона через admin-only RPC с audit.
- Controlled validation panel: valid/warning/error, без генерации.
- Phase 2 proof + billing regression proof.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing-резолвер, billing FLD — нетронуты.

## 9. Что НЕ делается в этой фазе

- Реальный dry-run и генерация пакета (Sprint 3G).
- HARDCODED_ENABLED в `resolve-package-tokens.ts` остаётся `false`.
- Новые FLD без manifest-proof.
- Изменения в группах «Заказчик/Исполнитель ЮЛ/ИП/ФЛ».