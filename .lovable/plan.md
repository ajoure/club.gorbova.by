

да, согласен, с учетом правок:

## **1. Исправить модель role-токенов**

В плане нельзя использовать формат:

```text
{{package.roles.<role_key>.full_name}}
{{package.roles.<role_key>.short_name}}
{{package.roles.<role_key>.position}}
```

Нам не нужны отдельные токены `full_name`, `short_name`, `position`.

Канонический формат role-placeholder должен быть один:

```text
{{package.role.PKR-000001}}
```

Где `PKR-000001` — стабильный `public_id` роли из `document_package_role_catalog`.

## **2. Роль = package-scoped entity**

Каждая роль создаётся внутри конкретного пакета документов.

Пример:

```text
Пакет: Идеология
Роль: Ответственный за идеологическую работу
public_id: PKR-000001
placeholder: {{package.role.PKR-000001}}
```

Такая же по названию роль в другом пакете должна получить другой `public_id`.

Пример:

```text
Пакет: Ответ по балансу
Роль: Ответственный за подготовку ответа
public_id: PKR-000025
placeholder: {{package.role.PKR-000025}}
```

Нельзя делать глобальную роль по названию, которая потом будет сквозить через все пакеты.

## **3. Не использовать role_key как публичный token-id**

`role_key` можно оставить как внутреннее техническое поле для совместимости, но он не должен использоваться в Word-шаблонах.

Запрещённый формат:

```text
{{package.roles.ideology_responsible.full_name}}
{{package.roles.responsible_person.position}}
```

Правильный формат:

```text
{{package.role.PKR-000001}}
```

## **4. Добавить public_id для ролей пакета**

Если в `document_package_role_catalog` ещё нет стабильного публичного ID, добавить:

```text
public_id text NOT NULL UNIQUE
```

Формат:

```text
PKR-000001
PKR-000002
PKR-000003
```

Существующим 11 ролям пакета «Идеология» присвоить `public_id`.

## **5. Группа плейсхолдеров «Пакет: Роли»**

В UI `/admin/documents → Плейсхолдеры` должна быть группа:

```text
Пакет: Роли
```

Внутри — подгруппы по пакетам:

```text
Пакет: Роли → Идеология
Пакет: Роли → Ответ по балансу
```

Внутри каждой подгруппы показываются роли конкретного пакета.

Пример:

```text
Пакет: Роли → Идеология

Ответственный за идеологическую работу
{{package.role.PKR-000001}}

Составитель документов
{{package.role.PKR-000002}}

Ознакомленное лицо
{{package.role.PKR-000003}}
```

Технический ID можно показывать только в debug-колонке для super_admin.



## **6. Что подставляет**

`{{package.role.PKR-000001}}`

Этот плейсхолдер должен возвращать готовое значение роли, сформированное из:

```text
document_package_role_catalog.public_id
→ document_package_session_participants.role_catalog_id
→ legal_details_persons
→ metadata.position
```

То есть система берёт физлицо, назначенное на эту роль в конкретной package session, и подставляет его данные.

Формат вывода роли должен храниться в настройках роли или package role metadata.

Например:

```text
position + full_name
```

или другой утверждённый формат.

Но в Word-шаблоне должен быть один placeholder:

```text
{{package.role.PKR-000001}}
```

А не отдельные:

```text
full_name
short_name
position
```

## **7. Custom roles**

В настройках пакета должна быть возможность добавить роль вручную:

```text
Название роли: Ответственный за идеологическую работу
```

После сохранения система:

1. создаёт запись в `document_package_role_catalog`;
2. присваивает `public_id`;
3. показывает эту роль в dropdown анкеты пакета;
4. показывает её в каталоге плейсхолдеров;
5. создаёт копируемый placeholder:

```text
{{package.role.PKR-000001}}
```

## **8. Переименование роли не должно ломать шаблоны**

Если роль переименовали:

```text
Ответственный за идеологическую работу
```

в:

```text
Специалист по идеологической работе
```

Word-шаблон не меняется, потому что в нём остаётся:

```text
{{package.role.PKR-000001}}
```

## **9. Validator**

Validator должен принимать:

```text
{{package.role.PKR-000001}}
```

Проверки:

- `PKR-000001` существует в `document_package_role_catalog`;
- роль относится к тому пакету, к которому привязан шаблон;
- роль активна;
- в текущей анкете пакета есть физлицо, назначенное на эту роль;
- если физлицо не назначено — validation warning/error с понятным текстом.

## **10. Оставить системные и document-плейсхолдеры**

В package-template разрешены:

```text
{{field:FLD-000069}}  // номер документа
{{field:FLD-000209}}  // сегодня прописью
{{field:FLD-000211}}  // текущий год
```

Системные, документные и общие поля можно использовать в пакетных документах.

Запрет касается только использования биллинговых реквизитов заказчика/исполнителя вместо package-aware реквизитов.

## **11. Не делать**

- Не создавать `{{package.roles.<role_key>.full_name}}`.
- Не создавать `{{package.roles.<role_key>.position}}`.
- Не создавать `{{package.roles.<role_key>.short_name}}`.
- Не использовать русское название роли в токене.
- Не использовать `role_key` как публичный идентификатор Word-плейсхолдера.
- Не создавать отдельные роли глобально для всех пакетов.
- Не создавать новые таблицы реквизитов.
- Не трогать billing resolver.
- Не трогать `canonical-document-generate-strict`.
- Не запускать генерацию.

## **12. Исправить Sprint 3F план**

В Sprint 3F заменить весь блок:

```text
Пакет: Роли — full_name / short_name / position
```

на модель:

```text
Пакет: Роли → <Название пакета>
{{package.role.PKR-XXXXXX}}
```

Роль — это одна сущность с одним стабильным ID и одним копируемым placeholder.

## **Итог**

Твоя схема правильная:

```text
Пакет → роли пакета → каждая роль получает ID → этот ID вставляется в Word.
```

Не нужно плодить:

```text
full_name
short_name
position
```

Это должен решать resolver/настройка роли, а не Word-шаблон.

&nbsp;

Sprint 3F — Package placeholders completion + template binding + custom roles + validator scope

## 0. Цель

После Sprint 3F администратор может:

- Видеть полные группы плейсхолдеров: **Пакет: ЮЛ / ИП / ФЛ / Пакет: Роли**.
- Скопировать package-aware токены в DOCX.
- Загрузить DOCX-приказ, привязать к пакету «Идеология» и получить per-token validation report **без генерации**.
- В анкете пакета **добавлять свои роли** для физлиц (не только из захардкоженного списка).

Реальная генерация, Gotenberg, `ai_generated_documents`, `canonical-document-generate-strict`, billing resolver — НЕ трогаются.

---

## 1. Discovery (выполнено, факты)

- `**document_package_token_aliases**` уже использует canonical **plural** формат: `package.roles.company_head.full_name|position`, `package.roles.ideology_responsible.full_name|position`. `role_key = ideology_responsible` (НЕ `responsible_person`). Реюзают FLD-000372/373.
- `**fields_registry**`: FLD-000069 = «Номер документа», FLD-000209 = «Сегодня прописью», FLD-000211 = «Текущий год».
- `**document_templates.template_scope text**` уже существует — миграция не нужна.
- `**document_package_role_catalog**` per-package_template (FK `package_template_id`), колонки: `role_key, label, description, allowed_entity_types, required, min_count, max_count, sort_order, is_active, metadata`. Сейчас 11 системных ролей для пакета «Идеология». Это уже готовая база для custom roles.

---

## 2. Жёсткие правила (canonical decisions)

### 2.1 Role-token формат — **plural**

Единственный canonical формат: `**{{package.roles.<role_key>.<attr>}}**`. `package.role.*` (singular) НЕ используется нигде — ни в каталоге, ни в валидаторе, ни в alias-таблице.

### 2.2 Role keys = реальные ключи из `document_package_role_catalog`

Каноническая роль ответственного — `**ideology_responsible**` (не `responsible_person`). Existing aliases остаются как есть.

### 2.3 Минимальный набор role-токенов (для приказа идеологии)

```
{{package.roles.ideology_responsible.full_name}}     ФИО ответственного
{{package.roles.ideology_responsible.short_name}}    ФИО кратко
{{package.roles.ideology_responsible.position}}      Должность (из metadata.position)
```

**Не создавать** package-role-токены для `company_head` как "руководитель организации" — руководитель ЮЛ/ИП уже идёт из реквизитов (`{{package.ul.FLD-...}}` директор/должность/основание). Existing `package.roles.company_head.*` aliases — оставить как есть (legacy, не удалять), но в Sprint 3F **не показывать** в UI каталога как первичные; пометить deprecated с комментарием «дублирует Пакет: ЮЛ → Руководитель *».

### 2.4 Validator scope (правка к B.3)

Шаблон классифицируется по факту привязки в `document_package_template_items`:

- `template_id ∈ document_package_template_items` → **package template**;
- иначе → **billing template**.

В **package template** разрешены:

- `{{field:FLD-XXXXXX}}` любого scope — системные (FLD-000209 «Сегодня прописью», FLD-000211 «Текущий год»), документные (FLD-000069 «Номер документа»), общие. Они НЕ блокируются.
- `{{package.ul|ip|fl.FLD-XXXXXX}}` — package-aware реквизиты.
- `{{package.roles.<role_key>.<attr>}}` где `role_key` присутствует в `document_package_role_catalog` для этого `package_template_id`.

**Warning (не error)** в package template: `{{field:FLD-XXXXXX}}`, чей FLD принадлежит группам «Заказчик ЮЛ / ИП / ФЛ» или «Исполнитель ЮЛ»:

> «Этот плейсхолдер относится к биллинговым реквизитам. Для реквизитов пакета используйте package-aware плейсхолдер из групп Пакет: ЮЛ / ИП / ФЛ.»

В **billing template** — без изменений: `package.*` запрещены как error.

### 2.5 Что НЕ запрещать

`legacy_placeholder_format_detected` НЕ должен срабатывать на `{{package.*}}` ни в каком scope (для billing — другая категория error: `package_token_in_billing_template`).

---

## 3. Этап A — Preflight (read-only)

- Извлечь токены загруженного DOCX-приказа через `extractDocxPlaceholders.ts`. Свести таблицу `raw_token | kind | recognized | source | required_action`.
- Сверить `packagePlaceholderCatalog.ts` (62/74 copy_ready по факту Sprint 3E) → таблица оставшихся 12 с решением `make_copy_ready_now | needs_new_fld (manifest) | keep_deferred`.
- Pre-flight RLS: подтвердить, что admin/super_admin могут писать в `document_package_template_items` и `document_package_role_catalog`.

Артефакт: `.lovable/proofs/package_documents_sprint3f_preflight_2026_05.md`.

---

## 4. Этап B — Validator: package-aware scope rules

### B.1 Локализовать validator

Найти источник ошибки `legacy_placeholder_format_detected` (вероятно `StrictDocumentTemplatesManager`/`TemplateMarkupDialog`/edge `validate-template`). Подтвердить точку расширения regex/whitelist.

### B.2 Расширить grammar

Принимаемые формы в package scope:

```
{{field:FLD-\d{6}(\|[^}]+)?}}
{{package\.(ul|ip|fl)\.FLD-\d{6}(\|[^}]+)?}}
{{package\.roles\.[a-z_][a-z0-9_]*\.(full_name|short_name|position)(\|[^}]+)?}}
```

Резолюция `role_key`: чтение `document_package_role_catalog WHERE package_template_id = ? AND is_active`. Если ключа нет → error `unknown_package_role`.

### B.3 Тесты (Vitest)

- `{{field:FLD-000069}}` в package template → **valid** (документный «Номер документа»).
- `{{field:FLD-000209}}` в package template → **valid** (системный «Сегодня прописью»). **Исправление к предыдущему черновику: FLD-000209 — не номер документа, а «Сегодня прописью».**
- `{{field:FLD-000211}}` в package template → **valid** (системный «Текущий год»).
- `{{field:FLD-<billing UL>}}` в package template → **warning** `billing_token_in_package_template_warning` (НЕ error, генерация/copy не блокируется).
- `{{package.ul.FLD-000039}}` в package template → **valid**.
- `{{package.roles.ideology_responsible.full_name}}` в package template (роль есть в каталоге) → **valid**.
- `{{package.roles.unknown_role.full_name}}` → **error** `unknown_package_role`.
- `{{package.ul.FLD-000039}}` в billing template → **error** `package_token_in_billing_template`.
- `{{ul.FLD-...}}` без префикса `package.` → **error** `invalid_syntax`.

---

## 5. Этап C — Полные группы Пакет: ЮЛ / ИП / ФЛ

Целевые числа: UL 24/24, IP 24/24, FL 26/26 — либо явный `keep_deferred` с причиной.

Для полей, где source есть, а FLD нет → **manifest-proof в proof** (`label, data_type, source_table, source_path, package_group, billing_analog, duplicate_check, reason`). **FLD создаём только по одобренному manifest'у**, без авто-создания.

Для полей без source → `keep_deferred` с фиксацией причины (отсутствие колонки/jsonb-ключа).

---

## 6. Этап D — Пакет: Роли (минимальный + custom)

### D.1 UI-группа «Пакет: Роли» в каталоге плейсхолдеров

Показывает токены, построенные из `document_package_role_catalog` для каждого активного package_template'а:

```
{{package.roles.<role_key>.full_name}}
{{package.roles.<role_key>.short_name}}
{{package.roles.<role_key>.position}}
```

Для пакета «Идеология» (текущие 11 ролей) — первичный показ только `ideology_responsible` (3 токена). Остальные системные роли (`document_signer`, `document_preparer`, `control_person`, `ideology_active_member`, `ideology_participant`, `notified_person`, `report_participant`, `external_specialist`) — отображаются под expand-секцией «Дополнительные роли» с пометкой «опциональные». `company_head` помечен `deprecated: дублирует Пакет: ЮЛ → Руководитель *`. `package_company` — не показывается (это сам package company entity, не физлицо).

### D.2 Resolver contract (documentation only, generation deferred)

```
person = legal_details_persons WHERE id = (
  SELECT person_id FROM document_package_session_participants
  WHERE session_id = ? AND role_key = ?
)
position = document_package_session_participants.metadata->>'position'
short_name = existing formatter over legal_details_persons.full_name
```

### D.3 Aliases

Existing aliases (`package.roles.company_head.*`, `package.roles.ideology_responsible.*`) — не трогаем. Для `short_name` добавляем alias-row только если выбрана стратегия «alias-резолвер»; альтернатива — резолвить через runtime formatter без alias-записи (предпочтительно, чтобы не плодить aliases на каждый attr). Решение зафиксировать в proof.

---

## 7. Этап E — Custom roles per package (новое)

### E.1 Источник правды

`document_package_role_catalog` уже per-package_template — миграция структуры не нужна. Достаточно UI + permissions.

### E.2 UI «Пакеты документов → <Пакет> → Роли пакета»

Новая секция в admin под «Состав пакета»:

- Таблица ролей: `label | role_key | required | min/max | sort_order | is_active | actions`.
- Кнопка «Добавить роль»: форма (`label` ru, `role_key` — auto-slug из label с превью, `description`, `required` чекбокс, `min_count`, `max_count`, `sort_order`).
- Edit/Archive (soft через `is_active=false`, не DELETE — чтобы не сломать существующих participants).
- Системные роли (`metadata.is_system=true` — добавить признак миграцией) защищены от удаления и переименования `role_key`, можно редактировать только `label/required/sort_order/is_active`.

### E.3 role_key validation

- snake_case, regex `^[a-z][a-z0-9_]{1,40}$`;
- unique per `(package_template_id, role_key)` (уже подразумевается; добавить partial unique index если нет);
- запрещены reserved keys: `package_company`.

### E.4 Wiring в анкету пакета

Dropdown «Роль» в `document_package_session_participants` UI читает `document_package_role_catalog WHERE package_template_id = current AND is_active` — автоматически подхватит custom-роли без кода.

### E.5 Wiring в каталог плейсхолдеров

Сразу после создания custom-роли в каталоге появляются 3 токена (`full_name/short_name/position`) под той же группой «Пакет: Роли → <Пакет>». Никаких aliases для custom-ролей не пишем — resolver работает по generic правилу (см. D.2) с lookup `role_key` в каталоге.

### E.6 Permissions

`document_package_role_catalog` write-операции — только admin/super_admin. По pre-flight RLS (этап A): если direct INSERT/UPDATE/DELETE из frontend безопасен под текущими policies — использовать direct path; иначе — edge-функции `package-role-upsert` / `package-role-archive` + `audit_logs.action ∈ {package_role_created, package_role_updated, package_role_archived}`.

### E.7 Миграция

Добавить колонку (если ещё нет) `is_system boolean default false` в `document_package_role_catalog` и проставить `true` для 11 текущих строк пакета «Идеология». Никаких других схемных изменений.

---

## 8. Этап F — Template-to-package binding

### F.1 Source of truth

`document_package_template_items` (template_id присутствует → package-template). `document_templates.template_scope` уже существует — используем как denormalized hint (синхронизировать триггером ИЛИ обновлять явно при link/unlink). Решение: **обновлять явно** в link/unlink action, без триггера, чтобы избежать побочных эффектов на billing-шаблоны.

### F.2 UI «Шаблоны документов»

Селект «Тип шаблона»: `Биллинговый | Пакет документов`. При выборе «Пакет» — селект пакета (`document_package_templates`) и кнопка «Привязать». UPSERT в `document_package_template_items` + UPDATE `document_templates.template_scope='package'`.

### F.3 UI «Пакеты документов → <Пакет> → Состав пакета»

Уже есть пустой плейсхолдер «Состав пакета». Заполнить: список привязанных шаблонов (название, версия, validation status из B, required/optional, sort_order, кнопки «Открыть»/«Отвязать»).

### F.4 Permissions

По pre-flight RLS. Если нужны edge — `link-template-to-package`/`unlink-template-from-package` (super_admin/admin) + `audit_logs.action ∈ {package_template_item_linked, package_template_item_unlinked}`.

---

## 9. Этап G — Controlled validation (no generation)

В диалоге шаблона: кнопка «Проверить плейсхолдеры». Использует `extractDocxPlaceholders` + новый валидатор (B). Per-token статус: green/yellow(warning)/red(error) с точной причиной из набора: `unknown_package_group | unknown_fld | unknown_package_role | no_source_path | invalid_syntax | billing_token_in_package_template_warning | package_token_in_billing_template`.

Запрещено вызывать: Gotenberg, `canonical-document-generate-strict`, запись в `ai_generated_documents`, storage write, snapshot/source_trace write.

---

## 10. Этап H — Proof

`.lovable/proofs/package_documents_sprint3f_placeholder_completion_and_template_binding_2026_05.md`:

1. **Before**: скриншот ошибок `legacy_placeholder_format_detected` на текущем DOCX.
2. Validator diff + Vitest run (B.3).
3. Таблицы UL 24/24, IP 24/24, FL 26/26 (или manifest для пробелов).
4. Таблица «Пакет: Роли» (3 первичных + список системных + механика custom).
5. Custom roles: UI скрины, RLS proof, audit_logs sample.
6. Template-to-package binding: UI скрины, RLS proof, audit sample.
7. Validation proof по приказу идеологии (per-token).
8. **After**: те же токены валидны / warning / error по новым правилам.
9. Billing regression: `{{field:FLD-...}}` в billing-шаблонах работает; группы «Заказчик/Исполнитель» не изменились; `canonical-document-generate-strict` diff пуст.
10. No-generation proof: 0 Gotenberg, 0 `ai_generated_documents` за окно.

Memory update `mem://architecture/documents/package-token-aliases-v1`: добавить разделы (a) canonical formato = plural, (b) FLD-000209 = «Сегодня прописью» (не номер документа), (c) custom roles per package_template через `document_package_role_catalog`, (d) validator scope rules (warning vs error), (e) template_scope SOT = `document_package_template_items`.

---

## 11. DoD

- Validator принимает `{{field:FLD-...}}` (системные/документные), `{{package.ul|ip|fl.FLD-...}}`, `{{package.roles.<role_key>.<attr>}}` в package-template; billing FLD из заказчик/исполнитель групп → warning.
- DOCX приказа больше не падает с `legacy_placeholder_format_detected` по package-aware токенам.
- Каталог: 4 группы; «Пакет: Роли» показывает custom-роли мгновенно после их создания.
- В UI пакета «Идеология» можно добавить произвольную роль; она появляется в dropdown анкеты и в каталоге плейсхолдеров.
- Шаблон можно привязать к пакету; привязка видна в «Состав пакета»; права — admin/super_admin only.
- Validation работает без генерации; Gotenberg/ai_generated_documents/strict не вызывались.
- Billing-шаблоны не сломаны.

---

## 12. Финальный статус

```
completed: package placeholders ready for DOCX authoring (UL/IP/FL/Roles incl. custom per-package);
package-aware syntax accepted by validator;
billing tokens in package template raise warning, not error;
template-to-package binding implemented (UI + permissions);
ideology DOCX linked and validation-ready;
real generation remains deferred
```

## 13. Вне scope

Реальная генерация, Gotenberg, `ai_generated_documents`, подключение package resolver в `canonical-document-generate-strict`, snapshot/source_trace, отдельный namespace `documents:package:ideology`, новые таблицы реквизитов, изменения billing FLD и группы «Заказчик/Исполнитель», удаление legacy `document_package_token_aliases`.