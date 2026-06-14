
План: PATCH-PACKAGE-CUSTOM-FIELDS-V1 — «Роли и поля пакета» + назначения полей анкетам документов

## Цель
Дать администратору пакета возможность завести **per-package кастомные поля** (`pf-XXXXXX`) и назначать их в анкеты конкретных DOCX-шаблонов пакета. Поле создаётся один раз в каталоге пакета, может использоваться во всех его шаблонах, заполняется клиентом один раз и подставляется в каждый документ через единый токен `{{pf-XXXXXX}}` с модификаторами падежей/формата/прописью, как у `{{field:FLD-XXXXXX}}` и `{{ln-XXXXXX}}`. Канон ролей `{{ln-XXXXXX}}` и биллинговый `{{field:FLD-XXXXXX}}` **не трогаем**.

---

## Архитектурная карта

```text
Token namespaces (after patch):
  {{field:FLD-XXXXXX}}             biller-level (global fields_registry)            — unchanged
  {{ln-XXXXXX}}                    package role (per-package role catalog)          — unchanged
  {{pf-XXXXXX}}                    NEW: per-package custom field
  {{package.ul|ip|fl.FLD-XXXXXX}}  client requisites (Sprint 3D)                    — unchanged

Two levels of configuration:
  Level A — «Роли и поля пакета»   (catalog, per package)
    document_package_role_catalog       — unchanged
    document_package_field_catalog      — NEW

  Level B — «Анкеты документов»    (assignments, per package_item)
    document_package_item_role_assignments  — unchanged
    document_package_item_field_assignments — NEW (mapping pf-field → package_item)

  Values per session:
    document_package_session_field_values   — NEW (single value per pf-field per session)

Client questionnaire build path:
  selected package items
    → item field assignments
      → unique field_catalog_id
        → ask the client ONCE
          → value reused in every DOCX with {{pf-XXXXXX}}
```

Принцип: **постоянный каталог → настройка документа → значение сессии → snapshot генерации**. Один `pf-XXXXXX` — одно значение на сессию, многократное использование в шаблонах.

---

## 1. БД (одна миграция)

### 1.1 `public.document_package_field_catalog` — каталог полей пакета
* `id uuid pk`,
* `package_template_id uuid not null fk → document_package_templates (CASCADE)`,
* `workspace_id uuid` — вычисляется и фиксируется триггером из родительского пакета; immutable; учитывается во всех RLS,
* `public_id text unique not null` формата `pf-XXXXXX` (генерится триггером через `public_id_sequences`, immutable),
* `field_key text not null` — slug, технический; уникален в пакете при `is_active=true`; **immutable после создания**,
* `label text not null`, `description text null`,
* `data_type text not null` CHECK ∈ `{text, number, date, datetime, time, year, select, multiselect, checkbox}`; **immutable**,
* `options jsonb default '{}'` — `{ choices: [{value,label,sort_order,is_archived}], default_kind, format_hint, modifier_defaults }`,
* `usage_scope text default 'package_all'` CHECK ∈ `{package_all, questionnaire_only, documents_only}`,
* `client_visible boolean default true`,
* `admin_editable boolean default true`,
* `auto_assign_to_new_items boolean default false` — управляет автодобавлением в новые шаблоны пакета,
* `required boolean default false` (базовое требование; mapping может усиливать),
* `sort_order int default 100`,
* `is_active boolean default true`,
* `is_system boolean default false`,
* `metadata jsonb default '{}'`,
* `version int default 1` — optimistic concurrency,
* стандартные `created_at/updated_at/created_by/updated_by`.

Триггеры/защиты:
* `pf-XXXXXX` — immutable;
* `data_type` и `field_key` — immutable после INSERT;
* `workspace_id` — immutable;
* `is_system=true` нельзя удалить;
* uq `(package_template_id, field_key) where is_active`;
* uq `(package_template_id, public_id)`;
* CHECK на `options.choices`: для `select|multiselect` — массив с уникальными `value`, не пустыми; для `date|datetime|year` — `default_kind` ∈ enum (см. §3).

GRANT + RLS:
* `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated`, `GRANT ALL … TO service_role`;
* RLS:
  * `admin_all_in_workspace` — admin/super_admin своего workspace (через `has_role_v2` + workspace check) — full;
  * `select_for_package_consumers` — SELECT только если у пользователя есть активная `document_package_sessions` по этому `package_template_id` (узкая политика, **не** «все authenticated видят все поля всех пакетов»);
  * service_role — bypass.

### 1.2 `public.document_package_item_field_assignments` — назначение поля шаблону документа
* `id uuid pk`,
* `package_template_item_id uuid not null fk → document_package_template_items (CASCADE)`,
* `field_catalog_id uuid not null fk → document_package_field_catalog (RESTRICT)`,
* `workspace_id uuid` (immutable trigger, mirrors parent),
* `visibility_mode text default 'ask_client'` CHECK ∈ `{ask_client, admin_only, hidden_with_default}`,
* `is_required_override boolean null` — null = наследуется из каталога,
* `label_override text null`,
* `help_override text null`,
* `section_key text null` — секция в анкете,
* `sort_order int default 100`,
* `is_active boolean default true`,
* `metadata jsonb default '{}'`,
* стандартные timestamps + actor.

Защиты:
* uq `(package_template_item_id, field_catalog_id)`;
* триггер `assert_field_package_match` — `field_catalog.package_template_id` обязан совпадать с `package_template_id` родителя `package_template_item_id`; иначе RAISE EXCEPTION (аналог `dpira_assert_package_match`);
* НИКОГДА не дублирует `public_id / data_type / choices / default_kind / global label` поля — только настройки использования.

GRANT + RLS: admin/super_admin своего workspace + service_role. SELECT для владельца сессии — через RPC анкеты (см. §4.2), не широкой политикой.

### 1.3 `public.document_package_session_field_values` — значения сессии
* `id uuid pk`,
* `session_id uuid not null fk → document_package_sessions (CASCADE)`,
* `field_catalog_id uuid not null fk → document_package_field_catalog (RESTRICT)`,
* `workspace_id uuid` (immutable trigger),
* `value_text text null`, `value_number numeric null`, `value_date date null`, `value_datetime timestamptz null`, `value_time time null`, `value_boolean boolean null`, `value_json jsonb null`,
* uq `(session_id, field_catalog_id)`,
* timestamps + actor.

CHECK: ровно одна `value_*` колонка NOT NULL для не-NULL значения (полная типизация); см. §4.2 — гарантируется RPC.

GRANT + RLS:
* владелец сессии (`profile_id = auth.uid()`-производный) — INSERT/UPDATE/SELECT/DELETE через RPC;
* admin/super_admin своего workspace — read-write;
* service_role — full (нужно резолверу при генерации).

### 1.4 Что НЕ меняем в БД
`document_package_role_catalog`, `document_package_item_role_assignments`, `document_package_session_participants`, `document_package_token_aliases`, `fields_registry`, `document_token_registry`, RPC `create_global_document_package` и т.д.

---

## 2. Source of truth и no-duplication contract

* `pf-XXXXXX` создаётся **только** в `document_package_field_catalog` — единственный источник истины поля.
* `document_package_item_field_assignments` **никогда** не копирует `public_id / data_type / choices / default_kind / global label`. Только overrides использования.
* `document_package_session_field_values` хранит **одно** значение на пару `(session, field_catalog_id)` — клиент отвечает один раз, ответ применяется во всех документах пакета с этим `{{pf-XXXXXX}}`.
* Дедуп в анкете — строго по `field_catalog_id`, не по label/токену.
* Резолвер при подстановке `{{pf-XXXXXX}}` читает значение из `session_field_values` независимо от того, в скольких шаблонах есть токен.

---

## 3. Smart-date (default_kind) — read-only библиотека

`default_kind` — это **prefill в анкете**, не отдельный `data_type`. Применим только к `date|datetime|year`. В UI выводится в форме создания поля как Select.

Полный список:
```
none | today | tomorrow | yesterday |
first_day_of_week | last_day_of_week |
first_day_of_month | last_day_of_month |
first_day_of_quarter | last_day_of_quarter |
first_day_of_year | last_day_of_year |
session_created_date | generation_date
```

Расчёт:
* В timezone организации/пакета (берём `Europe/Minsk` как канон проекта; если у `document_package_templates` есть/появится `timezone` — читаем оттуда; иначе `Europe/Minsk`).
* Никогда не из UTC браузера.
* `session_created_date` → `document_package_sessions.created_at` в TZ;
* `generation_date` → дата генерации документа в TZ (вычисляется резолвером в момент генерации, в анкете отображается hint «дата генерации»);
* prefill **не пишется в БД при открытии анкеты** — становится `session_field_value` только после явного сохранения формы.

Реализация: shared helper `src/lib/packageFields/smartDate.ts` + зеркало `supabase/functions/_shared/smart-date.ts`. Юнит-тесты на каждый kind + TZ.

---

## 4. UI

### 4.1 Вкладка таб-триггера
`src/components/ai-documents/packages/PackagesWorkspace.tsx`:
* `<TabsTrigger value="roles"> … Роли пакета</TabsTrigger>` → **«Роли и поля пакета»** (иконка `Users` или `UsersRound`, без логических изменений).

Содержимое таба = две секции, друг под другом, единый паттерн (Card + список + Активные/Архив + поиск):
1. `PackageRolesManager` — без изменений.
2. **`PackageFieldsManager`** — новый компонент.

### 4.2 `PackageFieldsManager.tsx` + хук `usePackageFieldCatalog.ts`
Колонки:
* Название (label) | Тип (data_type) | ID `pf-XXXXXX` | Видимость (`usage_scope`, `client_visible`, `admin_editable`) | Обязательно | Используется в N шаблонах (link → раскрывает список документов) | Действия (Copy token, Edit, Archive/Restore).

Диалог создания/редактирования:
* Label, Description, Data type (Select; **после создания запрещён к смене** — disabled в edit-режиме);
* Required, Sort order, Active;
* `usage_scope` (Select: `package_all | questionnaire_only | documents_only`);
* `client_visible` (Switch), `admin_editable` (Switch), `auto_assign_to_new_items` (Switch);
* Для `select|multiselect` — редактор `choices`:
  * добавить/переименовать label,
  * **запрет** менять `value` уже существующего choice (только safe migration через миграцию данных, в UI — disabled),
  * reorder (drag),
  * archive отдельного choice (нельзя удалить, если использовалось хоть одной сессией),
  * уникальность `value`, запрет пустых/дублей;
* Для `date|datetime|year` — Select «Значение по умолчанию» из §3, `format_hint`;
* Для `number|date|datetime|time` — настройки модификаторов по умолчанию (см. §6 matrix).

Запись — через RPC `upsert_package_field_catalog(_payload jsonb, _expected_version int)`:
* проверяет workspace, права, optimistic concurrency (`version`),
* пишет в `document_package_field_catalog`,
* пишет audit (см. §11),
* возвращает строку + новый `version`.

Изменения с конфликтом версии → toast «Поле уже изменено другим администратором, обновите и повторите».

Перед архивированием показываем dependency-report dialog (RPC `report_package_field_dependencies`):
```
templates_using_token        : N (список с возможностью открыть шаблон)
active_sessions_with_value   : N
historical_sessions_with_value : N
generation_snapshots_count   : N
```
Архивирование — soft (`is_active=false`); DELETE — только если все четыре счётчика = 0 (отдельная кнопка «Удалить безвозвратно», прячется иначе).

### 4.3 Вкладка «Анкеты документов» (`DocumentPackageQuestionnairesView.tsx`)
Для каждого шаблона пакета (package_item) **новая под-секция** «Поля пакета» рядом с уже существующим назначением ролей:
* список доступных полей из каталога текущего пакета;
* per-field toggle «Использовать в этом документе» (создаёт/архивирует assignment);
* sort_order (drag);
* `is_required_override` (Switch with tri-state: наследовать/да/нет);
* `label_override`, `help_override`, `section_key`;
* `visibility_mode` Select: `ask_client | admin_only | hidden_with_default`;
* предпросмотр контрола (как клиент увидит вопрос);
* кнопка **«Добавить поле в анкету документа»** — комбобокс существующих полей пакета + ссылка «Создать новое поле» (открывает диалог из §4.2, после создания возвращается в комбобокс и тут же связывает);
* массовое действие **«Использовать во всех документах пакета»** — создаёт mapping-записи для всех текущих `package_items` (не меняет каталог), идемпотентно;
* при добавлении нового шаблона в пакет: поля с `auto_assign_to_new_items=true` автоматически получают assignment, остальные — нет.

Клиентская часть анкеты:
* строит вопросы как **объединение всех ассайнментов выбранных package_items**, дедуп по `field_catalog_id`;
* контролы по типу: text → `Input`, number → numeric `Input`, date → DatePicker (prefill `default_kind`), datetime → DateTimePicker, time → `Input type=time`, year → numeric, select → `Select`, multiselect → MultiSelect, checkbox → `Switch`;
* `visibility_mode='admin_only'` — поле показано только администратору;
* `visibility_mode='hidden_with_default'` — поле не показано, при сохранении сессии backend сам подставит `default_kind` (если он есть) либо пустое;
* при конфликте `label_override` в разных шаблонах: единый источник = label из каталога, баннер-warning админу;
* save — батч-RPC `upsert_session_field_values(_session_id, _values jsonb)`:
  * валидирует session ↔ package ↔ field принадлежность, права, тип значения, допустимость choices для select/multiselect, диапазон year, валидность date/time/datetime, boolean для checkbox;
  * нормализует значение в правильную колонку (`value_text/value_number/...`), остальные value-колонки = NULL;
  * пишет одну строку на field;
  * возвращает список ошибок по полям, не падает на первой.

### 4.4 «Проверка шаблонов» (`PackageTemplateValidationPanel.tsx`)
Добавить блок **«Поля анкеты документа»**:
* колонки: поле | `pf-XXXXXX` | найдено в DOCX | добавлено в анкету (assignment) | обязательность | статус;
* статусы:
  * `PASS` — токен в DOCX + assignment есть;
  * `error: token_without_assignment` — токен есть, mapping нет → анкета не спросит значение;
  * `warning: assignment_without_token` — assignment есть, токена в DOCX нет;
  * `STOP: token_belongs_to_other_package` — `pf-` другого пакета (резолвер вернёт `pf_token_outside_bound_package`);
  * `error: pf_token_not_found` — токен ссылается на несуществующий `pf-XXXXXX`.
* Использует тот же helper, что и резолвер (см. §5), чтобы избежать расхождений.

### 4.5 Каталог плейсхолдеров (`PlaceholdersCatalogTab.tsx`)
Добавить группу **«Пакет: Поля»** строго **в контексте выбранного пакета**. Без выбранного пакета — пустое состояние с подсказкой. Если режим «агрегированный по всем пакетам» когда-либо понадобится — каждая строка обязана нести: название пакета, `package_template_id`, public_id пакета (если есть), статус поля, баннер «использовать только в шаблонах этого пакета — иначе генерация остановится с `pf_token_outside_bound_package`». В рамках текущего патча по умолчанию — только режим «текущий пакет».

`src/utils/packagePlaceholderCatalog.ts` — добавить категорию `package_fields` (hint, mock examples, copy-кнопка).

---

## 5. Edge / Resolver

### 5.1 Общий canonical modifier helper
Перед добавлением `pf-` **выносим** существующую логику парсинга `|format=...|case=...` из `ln-` и FLD-резолверов в общий helper `supabase/functions/_shared/token-modifiers.ts` без изменения поведения старых namespace. Снимается на отдельном коммите внутри патча, покрывается существующими тестами `ln-`/FLD.

### 5.2 `resolve-package-tokens.ts`
Добавить ветку `PF_RE = /^pf-\d{6}$/` **после** `ln-` и **перед** generic fallback:
* lookup `document_package_field_catalog` по `(package_template_id, public_id)`;
  * нет совпадения → `pf_token_not_found`;
  * пакет не совпадает с биндингом текущего шаблона → `pf_token_outside_bound_package`;
* lookup значения `document_package_session_field_values` по `(session_id, field_catalog_id)`;
  * нет → если каталожное `required=true` ИЛИ assignment `is_required_override=true` для текущего `package_item` → `pf_required_value_missing` (с list `pf-XXXXXX`);
  * иначе → пустая строка (как FLD);
* форматирование через общий helper + matrix совместимости (§6); неподдерживаемый модификатор → `pf_unsupported_modifier` warning/error;
* для `select|multiselect` — выводим `label` через каталожный `choices`, храним `value`;
* для `checkbox` — настраиваемые `true_label/false_label` из `options`;
* для `date|datetime|year` — модификаторы `full|short|year_only|month_year`;
* для `number` — `format`, `decimals`, `spell_out=true` (переиспользуем helper FLD «прописью»).

`pf-` **никогда** не падает в legacy `document_package_token_aliases`.

### 5.3 Token manifest при генерации
* `canonical-document-generate-strict` уже строит token manifest и resolved snapshot. Проверяем: если `pf-` автоматически попадает в общий manifest по факту регулярки → код не меняем. Если нет — добавляем минимальный provider-neutral collector для `pf-` без нового pipeline.
* Snapshot для каждой генерации (`ai_generated_documents.meta.tokens_snapshot[]`) обязан содержать для каждого `pf-`:
  * `public_id`, `label_at_generation`, `data_type`, `raw_value`, `formatted_value`, `modifiers`, `source='session_field_value'`, `field_catalog_updated_at`, `assignment_id`, `warnings[]`.
* Перед генерацией — серверный required-check: собираем все `pf-XXXXXX` для всех генерируемых документов сессии, проверяем `session_field_values`. Если missing — STOP с `pf_required_value_missing` и перечислением полей. Анкетная проверка не считается достаточной.

### 5.4 Тесты резолвера (`resolve-package-tokens_test.ts`)
1. одно поле используется в двух разных шаблонах одного пакета → PASS;
2. поле другого пакета → FAIL `pf_token_outside_bound_package`;
3. архивное поле в существующей сессии — резолвится корректно (см. §8);
4. обязательное поле отсутствует → `pf_required_value_missing`;
5. неверный тип значения (стороннее изменение БД) → `pf_value_type_mismatch`;
6. invalid select choice → `pf_invalid_choice`;
7. multiselect formatting + separator;
8. checkbox formatting (true/false labels);
9. timezone smart-date prefill корректен для `Europe/Minsk`;
10. unsupported modifier → `pf_unsupported_modifier`;
11. токен не попадает в legacy alias fallback.

---

## 6. Modifier compatibility matrix
Жёстко закреплено в helper + проверяется и в анкете, и в резолвере:

| data_type   | разрешённые модификаторы |
|-------------|---------------------------|
| text        | `case` (падежи) |
| number      | `format`, `decimals`, `spell_out` |
| date        | `full`, `short`, `year_only`, `month_year` |
| datetime    | `full`, `short`, `year_only`, `month_year`, time-format |
| time        | формат времени (`HH:mm`/`HH:mm:ss`) |
| year        | `format` (число/прописью) |
| select      | `label` (default) / `value` |
| multiselect | `label`/`value`, `separator` |
| checkbox    | `true_label`/`false_label` |

Неподдерживаемый модификатор → warning в template validation; STOP-error в резолвере, если модификатор изменяет вывод (никогда «молча»).

---

## 7. choices контракт (select/multiselect)
`options.choices = [{value, label, sort_order, is_archived}]`:
* `value` — стабильный, immutable после первого использования;
* `label` — можно менять;
* удаление choice запрещено, если есть `session_field_values` с этим value (archive only);
* `value` уникален внутри поля, не пустой, без дублей;
* multiselect хранит `value[]`, выводит `label[]` через `separator`.

---

## 8. Lifecycle полей и assignment'ов
* Архивное поле (`is_active=false`):
  * не предлагается в новых assignment-комбобоксах;
  * не показывается в новых анкетах;
  * **продолжает** резолвиться в существующих draft-сессиях и исторических snapshot'ах;
  * админ видит его в режиме «Архив»;
  * восстановление НЕ меняет `public_id`.
* DELETE поля — только если dependency-report чист (см. §4.2).
* Удаление `package_template_item` → CASCADE удаляет только его `document_package_item_field_assignments`. Поле каталога и значения других документов не трогаем.
* Архивация поля не ломает уже создавшиеся draft-сессии: их `session_field_values` остаются, генерация продолжает резолвить.

---

## 9. Required перед генерацией (backend)
Серверный gate в pipeline генерации:
* собрать `pf-XXXXXX` из всех assignment'ов выбранных package_items + всех токенов, фактически встречающихся в DOCX (template validation);
* проверить `session_field_values`;
* отсутствие значения для required → STOP с `pf_required_value_missing: [pf-000001, pf-000007]`.

Required = OR(каталог.required, assignment.is_required_override).

---

## 10. Snapshot / history
Каждая генерация обязана записать в `ai_generated_documents.meta.tokens_snapshot[]` для каждого `pf-`:
`public_id`, `label_at_generation`, `data_type`, `raw_value`, `formatted_value`, `modifiers`, `source='session_field_value'`, `field_catalog_updated_at`, `assignment_id`, `warnings[]`. Это часть единой модели истории генерации — без неё патч считается невыполненным.

---

## 11. Audit
`audit_logs` события (actor_type, actor_user_id, actor_label, before, after, `package_template_id`, `field_catalog_id`):
```
document_package_field.created
document_package_field.updated
document_package_field.archived
document_package_field.restored
document_package_field.deleted
document_package_field.choice_changed
document_package_item_field.assigned
document_package_item_field.unassigned
document_package_item_field.updated
document_package_session_field.value_upserted
```
Все события пишутся серверно из RPC (см. §1.2/4.2/4.3) — клиент НЕ пишет audit напрямую.

---

## 12. Тесты

### 12.1 Юнит / RTL
* `usePackageFieldCatalog.test.ts` — CRUD happy/edge, optimistic concurrency conflict.
* `PackageFieldsManager.test.tsx` — рендер, копирование токена, dependency dialog, archive/restore.
* `useDocumentItemFieldAssignments.test.ts` — assign/unassign, массовое «во все документы», auto-assign на новый item.
* `smartDate.test.ts` — все `default_kind` × TZ.
* `token-modifiers.test.ts` — старые namespaces без регрессии + новый pf.

### 12.2 Edge
`resolve-package-tokens_test.ts` — 11 кейсов из §5.4 + required gate.

### 12.3 DB-линтер
Никаких новых security warnings; новые таблицы корректно покрыты RLS и GRANT'ами.

---

## 13. UAT (proof)
1. Создать поле «Дата приказа» (date, `default_kind=today`, required) в пакете «Годовое собрание участников».
2. Скопировать `{{pf-000001}}` (или назначенный id).
3. Вкладка «Анкеты документов»:
   * через «Добавить поле в анкету документа» назначить поле шаблону «Приказ»;
   * через «Использовать во всех документах пакета» — массово назначить остальным шаблонам;
   * вручную проверить, что в шаблоне «Протокол» поле тоже добавлено.
4. Вставить `{{pf-000001}}` минимум в два DOCX-шаблона пакета («Приказ» + «Протокол»).
5. Запустить анкету сессии: убедиться, что вопрос «Дата приказа» показан **один раз**, с prefill = today (TZ Минск).
6. Заполнить дату, сохранить, сгенерировать оба документа.
7. Подтвердить одинаковую корректную подстановку в обоих DOCX.
8. Назначить поле документу, но НЕ вставить токен в DOCX — получить `warning: assignment_without_token` в «Проверке шаблонов».
9. Вставить `{{pf-000001}}` в DOCX без assignment — получить `error: token_without_assignment` / STOP до генерации.
10. Попытаться вставить `{{pf-000001}}` в шаблон другого пакета — `pf_token_outside_bound_package`.
11. Регрессия: роли (`{{ln-XXXXXX}}`) и FLD (`{{field:FLD-XXXXXX}}`) продолжают работать в существующих пакетах.

Файл proof: `.lovable/proofs/package_custom_fields_2026-06-14.md`, разделы: ENGINEERING / DB MIGRATION / RESOLVER / UI / TESTS / UAT / CLEANUP. Source of truth — миграция, код, тесты, audit, proof. Память — дополнительная документация.

---

## 14. Что НЕ меняем
* `document_package_role_catalog`, `document_package_item_role_assignments`, `document_package_session_participants`, RPC `create_global_document_package` и пр.
* `fields_registry`, `document_token_registry`, `document_package_token_aliases`.
* `canonical-document-generate-strict` — кода не трогаем, если `pf-` уже автоматически попадает в token manifest; иначе минимальный provider-neutral патч (см. §5.3).
* Gotenberg, `ai_generated_documents` структура — не трогаем (только `meta.tokens_snapshot[]` обогащается полями pf, что уже поддержано схемой `jsonb`).
* Биллинговый FLD pipeline, `file_name_template` грамматика (FLD-000069 — warning-only).
* UI ролей (`PackageRolesManager`, `InlineCreateRoleDialog`).

---

## 15. Память
После выкатки добавить в `mem://index.md` запись `package_custom_fields_v1`:
* namespace `{{pf-XXXXXX}}`;
* источники: `document_package_field_catalog` + `document_package_item_field_assignments` + `document_package_session_field_values`;
* модификаторы — через общий canonical helper (`ln-`/FLD/pf);
* `pf-` валидно ТОЛЬКО внутри своего `package_template_id` (иначе `pf_token_outside_bound_package`);
* assignments — на уровне `package_item`, дедуп клиентского вопроса по `field_catalog_id`;
* default_kind — prefill, не запись; TZ Минск;
* no slug в новых артефактах.
Память — дополнение, не SoT.

---

## 16. Definition of Done

Базовый DoD:
1. Вкладка переименована в «Роли и поля пакета», содержит блоки «Роли» (без изменений) и «Поля» (новый).
2. Админ может создать/архивировать/удалить (если безопасно) поле пакета любого `data_type`, скопировать `{{pf-XXXXXX}}`, увидеть «Используется в N шаблонах».
3. Во вкладке «Анкеты документов» для каждого шаблона пакета админ видит доступные роли и поля пакета, назначает нужные вопросы конкретному документу, задаёт порядок, обязательность, label_override, `visibility_mode`.
4. Доступно массовое «Использовать во всех документах пакета» и `auto_assign_to_new_items`.
5. Клиент заполняет каждое уникальное поле **один раз**, после чего значение используется во всех шаблонах пакета, где присутствует соответствующий `{{pf-XXXXXX}}`. Дедуп строго по `field_catalog_id`.
6. Резолвер подставляет значения с модификаторами; некорректное использование (другой пакет, missing, unsupported modifier, missing required) даёт явные коды ошибок.
7. Snapshot генерации содержит расширенные данные по `pf-` (§10).
8. Audit пишется для всех CRUD событий каталога и assignment'ов (§11).
9. Все существующие сценарии (роли, FLD, генерация пакета) — без регрессий, покрыто тестами и UAT (§12–13).
10. Build green, DB linter clean, proof-файл создан, миграция применена.

Расширенный DoD (явная фиксация пользователя):
> Любое поле, созданное в каталоге конкретного пакета, может использоваться во всех шаблонах документов этого пакета без повторного создания поля и без дополнительного связывания с каждым шаблоном — массовое назначение `Использовать во всех документах пакета` и/или `auto_assign_to_new_items` решают этот случай в один клик; ручное назначение остаётся как опция тонкого контроля.

> Во вкладке «Анкеты документов» для каждого шаблона пакета администратор видит доступные роли и поля пакета, назначает нужные вопросы конкретному документу, задаёт порядок и обязательность. Клиент заполняет каждое уникальное поле один раз, после чего значение используется во всех шаблонах пакета, где присутствует соответствующий `{{pf-XXXXXX}}`.
