# Sprint 2 — Package placeholders registry audit + namespace design (Идеология)

> ⚠️ **SUPERSEDED (частично) — 2026-05-27.** Разделы про per-package namespace `documents:package:ideology` и вывод «все 8 FLD `entity_type='package'` корпоративные и для идеологии непригодны» **отменены**.
> Корректная модель: единый generic namespace `documents:package` + `document_package_role_catalog` как адаптационный слой. См. `package_documents_sprint2_3_generic_model_correction_2026_05.md`.
> Discovery-факты по таблицам и Sprint 1 verify checklist остаются в силе.

**Тип:** read-only audit + design.
**Запись в `fields_registry` / `document_token_registry` / picker / resolver: НЕ выполнялась.**
**Затронуты только новые markdown-артефакты (этот proof + backlog).**

---

## 1. Sprint 1 final UI verify (чек-лист §1 плана)

Чек-лист переносится в proof Sprint 1 (`package_documents_ideology_sprint1_persisted_session_2026_05.md`) и должен быть прогнан до старта Sprint 3.

| # | Проверка | Ожидаемый результат | Статус (заполняется при verify) |
|---|---|---|---|
| 1 | `/ai`, `/admin/ai` | Видна только Gorbova AI, документов нет | pending |
| 2 | `/admin/documents` | Нет дубля вкладки «Документы»; вкладки: Плейсхолдеры / Шаблоны / Пакеты документов / История / Исполнители | pending |
| 3 | `/admin/documents → Пакеты документов → Идеология` | Пакет открывается | pending |
| 4a | `/document-generation → Идеология` | Бейдж «локально» отсутствует | pending |
| 4b |  | Юрлицо/ИП single-select | pending |
| 4c |  | После reload выбор сохраняется | pending |
| 4d |  | Физлицам назначаются роли из `document_package_role_catalog` | pending |
| 4e |  | Required checklist работает | pending |
| 4f |  | Статус: «Сохранено» / «Требует заполнения» | pending |
| 5 | Incognito / другой браузер | Данные подтягиваются из backend, не из localStorage | pending |
| 6 | RLS | Чужие реквизиты/sessions/participants не видны | pending |
| 7 | Кнопка «Сформировать пакет» | Disabled с пояснением (генерация — Sprint 4) | pending |

## 2. Hardening follow-up по `save()`

Зафиксировано в `.lovable/backlog/document_package_session_save_atomicity.md`.

Краткая суть:

- `save()` сейчас = upsert + delete + insert тремя отдельными вызовами через supabase-js.
- Risk: ошибка `insert` после `delete` оставляет session без participants.
- Целевое решение — RPC `package_session_replace_participants(session_id, participants[])` в одной транзакции; внедрение перенесено в Sprint 3.
- В Sprint 2 atomicity-тест выполнен ТОЛЬКО как code-path analysis (см. §13).

---

## 3. Inventory: текущие placeholders

Источник: `fields_registry`, `document_token_registry` (live).

### 3.1 `fields_registry` по `entity_type` (всего категорий — 24)

| entity_type | count | назначение |
|---|---:|---|
| legal_details | 47 | реквизиты юрлица/ИП — core для актов и пакетов |
| user_requisites | 37 | реквизиты пользователя |
| customer / customer_ind / customer_leg / customer_ent / customer_signer | 20 / 26 / 24 / 24 / 4 | заказчик — billing/customer placeholders актов |
| executor / executor_leg | 15 / 23 | исполнитель — billing |
| document | 30 | акт/договор/услуга/сумма прописью/курс — billing |
| deal | 18 | сделка |
| payment | 14 | оплата |
| offer | 7 |  |
| tariff | 6 |  |
| product | 7 |  |
| meeting | 15 | корпоративные собрания |
| person | 12 |  |
| entity / entity_person | 6 / 6 |  |
| **package** | **8** | **корпоративные собрания (см. §3.3)** |
| agenda / decision | 1 / 1 |  |
| contact | 6 |  |
| system | 11 |  |

### 3.2 `document_token_registry` по `category` (всего категорий — 18)

| category | count |
|---|---:|
| customer / customer.individual / customer.legal / customer.entrepreneur / customer.signer | 12 / 26 / 24 / 24 / 4 |
| executor / executor.individual / executor.legal / executor.entrepreneur / executor.signer | 11 / 26 / 24 / 24 / 4 |
| deal | 38 |
| payment | 14 |
| document | 2 active (28 archived) |
| offer | 7 |
| product | 4 |
| tariff | 6 |
| system | 6 |
| contact | 6 |
| **package** | **0** |
| **postponed** | **0** |

**Вывод:** для пакетов сейчас в `document_token_registry` **ноль canonical-токенов**. Имя группы «Нет источника данных (postponed)» в UI — это группировка через filter, а не отдельная category в БД.

### 3.3 Все 8 package-FLD (`entity_type='package'`)

| public_id | key | label | data_type | назначение |
|---|---|---|---|---|
| FLD-000093 | `package.signer.full_name` | ФИО подписанта | text | корпоративные собрания (подписант протокола) |
| FLD-000094 | `package.signer.position` | Должность подписанта | text | корпоративные собрания |
| FLD-000095 | `package.chairperson.full_name` | ФИО председателя | text | корпоративные собрания |
| FLD-000096 | `package.secretary.full_name` | ФИО секретаря | text | корпоративные собрания |
| FLD-000097 | `package.participants` | Участники собрания (array) | array | корпоративные собрания |
| FLD-000098 | `package.registered_persons` | Зарегистрированные лица (array) | array | корпоративные собрания |
| FLD-000101 | `package.board_candidates` | Кандидаты в совет директоров (array) | array | корпоративные собрания |
| FLD-000102 | `package.commission_members` | Члены ревизионной комиссии (array) | array | корпоративные собрания |

**Подтверждено:** все 8 FLD имеют `source_strategy: 'package_role' | 'loop'` и принадлежат домену **«корпоративные собрания акционеров/учредителей»**, а НЕ идеологии. С идеологией ничего общего, кроме случайного совпадения префикса `package.*`.

### 3.4 Использование package-FLD в шаблонах

Запрос по `document_templates.placeholders`, `file_name_template`, `editor_draft_content`:

```
FLD-0000(93|94|95|96|97|98|101|102)  →  0 hits
LIKE %package.%                       →  0 hits
```

**Вывод:** ни один live document_template сейчас не использует существующие package-FLD. Безопасно оставить их `keep_as_is` (reserved namespace для собраний).

### 3.5 Inventory-таблица (решения по существующим package-FLD)

| FLD | label | используется в шаблонах | решение |
|---|---|---|---|
| FLD-000093 | ФИО подписанта | нет | `keep_as_is` (corporate meetings reserved) |
| FLD-000094 | Должность подписанта | нет | `keep_as_is` |
| FLD-000095 | ФИО председателя | нет | `keep_as_is` |
| FLD-000096 | ФИО секретаря | нет | `keep_as_is` |
| FLD-000097 | Участники собрания | нет | `keep_as_is` |
| FLD-000098 | Зарегистрированные лица | нет | `keep_as_is` |
| FLD-000101 | Кандидаты в совет директоров | нет | `keep_as_is` |
| FLD-000102 | Члены ревизионной комиссии | нет | `keep_as_is` |

Перенос/переименование запрещены. Идеология получает **отдельный namespace** (см. §6).

### 3.6 «Нет источника данных (postponed)» в UI

В БД отдельной `category='postponed'` нет. Группа в picker формируется UI-фильтром (полей без `source_strategy` / без mapping). Sprint 2 не меняет UI этой группы — рекомендации в §11.

---

## 4. Billing protected FLD list (Этап B)

Protected groups (изменения FLD-ID, label, source mapping, resolver, token format, category, падежей, formatting запрещены):

| protected group | category в `document_token_registry` | count активных | действие в Sprint 2 |
|---|---|---:|---|
| Заказчик (общий) | `customer` | 12 | no change |
| Заказчик ФЛ | `customer.individual` | 26 | no change |
| Заказчик ЮЛ | `customer.legal` | 24 | no change |
| Заказчик ИП | `customer.entrepreneur` | 24 | no change |
| Подписант заказчика | `customer.signer` | 4 | no change |
| Исполнитель (общий) | `executor` | 11 | no change |
| Исполнитель ФЛ | `executor.individual` | 26 | no change |
| Исполнитель ЮЛ | `executor.legal` | 24 | no change |
| Исполнитель ИП | `executor.entrepreneur` | 24 | no change |
| Подписант исполнителя | `executor.signer` | 4 | no change |
| Документ | `document` (+ archived) | 2 (28 archived) | no change |
| Сделка | `deal` | 38 | no change |
| Оплата | `payment` | 14 | no change |
| Оффер | `offer` | 7 | no change |
| Продукт | `product` | 4 | no change |
| Тариф | `tariff` | 6 | no change |
| Системные | `system` | 6 | no change |

Запрет на переименование групп зафиксирован в плане (§0/§14 утверждённого плана).

---

## 5. Целевая структура «Пакеты документов» (Этап C)

```text
Пакеты документов
  1. Общие поля пакета
       package.session.id
       package.template.title
       package.template.code
       package.status
       package.created_at
       package.updated_at

  2. Компания пакета                    ← document_package_sessions.selected_legal_entity_id → client_legal_details
       package.company.full_name
       package.company.short_name
       package.company.unp
       package.company.type
       package.company.legal_address
       package.company.postal_address
       package.company.bank_account
       package.company.bank_name
       package.company.bank_code
       package.company.head.full_name
       package.company.head.position
       package.company.head.authority_basis

  3. Роли пакета                        ← document_package_session_participants + document_package_role_catalog
       package.roles.<role_key>.full_name
       package.roles.<role_key>.position
       package.roles.<role_key>.phone
       package.roles.<role_key>.email
       package.roles.<role_key>.authority_basis

  4. Физлица пакета (массивы)           ← future (Sprint 3+), в registry в Sprint 2 НЕ материализуются
       package.participants[]
       package.notified_persons[]
       package.ideology_active_members[]

  5. Пакет «Идеология»                  ← package resolver + ideology role map
       ideology.order.number
       ideology.order.date
       ideology.plan.year
       ideology.responsible.full_name
       ideology.responsible.position
       ideology.components.list
       ideology.activities[]            (массив — Sprint 3+)
```

Namespace:

- `documents:package` — общие package-токены (групп 1–4 без массивов).
- `documents:package:ideology` — токены группы 5 + role map для ideology-ролей.
- Существующий namespace `documents:billing` / `documents:order` / `documents:payment` — НЕ меняется.

---

## 6. Proposed token list для «Идеологии»

Источники резолва описаны в §9.

### 6.1 Общие поля пакета (`documents:package`)

| proposed token_key | source | data_type |
|---|---|---|
| `package.session.id` | `document_package_sessions.id` | text |
| `package.template.title` | `document_package_templates.name` | text |
| `package.template.code` | `document_package_templates.code` | text |
| `package.status` | `document_package_sessions.status` | text |
| `package.created_at` | `document_package_sessions.created_at` | datetime |
| `package.updated_at` | `document_package_sessions.updated_at` | datetime |

### 6.2 Компания пакета (`documents:package`)

Все 12 токенов резолвятся из `client_legal_details` по `selected_legal_entity_id`. Подмножество уже покрыто 47 `legal_details` FLD — **в Sprint 2 решение по дублированию не принимается**, фиксируется в §7.

### 6.3 Роли пакета (`documents:package:ideology`)

11 ролей из `document_package_role_catalog` для пакета `ideology` (sort_order):

| sort | role_key | label | required | allowed_entity_types |
|---:|---|---|:---:|---|
| 10 | `package_company` | Организация пакета | ✓ | legal_entity, entrepreneur |
| 20 | `company_head` | Руководитель организации | ✓ | person |
| 30 | `ideology_responsible` | Ответственный за идеологическую работу | ✓ | person |
| 40 | `document_signer` | Подписант документов |  | person |
| 50 | `document_preparer` | Составитель документов |  | person |
| 60 | `control_person` | Контролирующее лицо |  | person |
| 70 | `ideology_active_member` | Член идеологического актива |  | person |
| 80 | `ideology_participant` | Участник мероприятий |  | person |
| 90 | `notified_person` | Ознакомленное лицо |  | person |
| 100 | `report_participant` | Участник отчёта |  | person |
| 110 | `external_specialist` | Внешний специалист/организация |  | legal_entity, entrepreneur, person |

Для каждой `person`-роли — токены `full_name | position | phone | email | authority_basis`.
Для `package_company` — токены через §6.2.
Для `external_specialist` — расширенный набор (зависит от entity_type).

### 6.4 Ideology-specific (`documents:package:ideology`)

| proposed token_key | source | data_type | статус |
|---|---|---|---|
| `ideology.order.number` | `allocate_document_number` (canonical, не трогаем) | text | needs_source (привязка к пакету — Sprint 3) |
| `ideology.order.date` | `document_package_sessions.meta.ideology.order_date` | date | needs_source (поле в session.meta — Sprint 3) |
| `ideology.plan.year` | `document_package_sessions.meta.ideology.plan_year` | number | needs_source |
| `ideology.responsible.*` | alias на `package.roles.ideology_responsible.*` | — | resolved |
| `ideology.components.list` | static enum из docx (приказ/положение/план) | text | resolved |
| `ideology.activities[]` | `document_package_sessions.meta.ideology.activities[]` | array | future (Sprint 3+) |

---

## 7. Duplicate guard (Этап D, dry-run)

| proposed token | exact key duplicate в `document_token_registry` | duplicate label | конфликт с billing | действие |
|---|:---:|:---:|:---:|---|
| `package.session.id` | нет | нет | нет | safe to create (Sprint 3) |
| `package.template.title` | нет | нет | нет | safe |
| `package.template.code` | нет | нет | нет | safe |
| `package.company.full_name` | нет | возможен с `customer.legal.full_name` (разные namespace) | нет | safe — namespace разделяет |
| `package.company.unp` | нет | возможен с `customer.legal.unp` | нет | safe — namespace разделяет |
| `package.company.bank_*` | нет | возможен с `customer.legal.bank_*` | нет | safe — namespace |
| `package.company.head.*` | нет | возможен с `customer.signer.*` | нет | safe — namespace |
| `package.roles.<role_key>.full_name` | нет | возможен с `customer.signer.full_name` | нет | safe — namespace |
| `package.signer.full_name` (legacy FLD-000093) | **ЕСТЬ FLD** | — | нет | reserved (corporate meetings) — **новый ideology-токен с тем же ключом создавать запрещено** |
| `ideology.*` | нет | нет | нет | safe |

**Critical conflict:** `package.signer.*` уже занят корпоративными собраниями (FLD-000093/094). Для ideology «подписант документов» использовать **только** `package.roles.document_signer.*` (новый namespace), а **не** `package.signer.*`.

В Sprint 2 НИ ОДИН токен в `document_token_registry` / `fields_registry` не создан — это dry-run.

---

## 8. Conflict matrix (Этап D)

| зона | риск | смягчение |
|---|---|---|
| `package.*` legacy (8 FLD корпоративных собраний) | случайное переиспользование ключей под идеологию | использовать `package.roles.<role_key>.*` / `package.company.*` / `ideology.*` — НЕ `package.signer.*`, `package.chairperson.*`, `package.secretary.*`, `package.participants` |
| совпадения labels с `customer.legal.*` / `customer.signer.*` | визуальная путаница в picker | context-aware picker (§9) показывает только релевантные группы |
| `document.*` (28 archived + 2 active) | расширение billing-токенов под пакет | НЕ расширять `document.*`; пакетные данные — в `package.*` / `ideology.*` |
| `allocate_document_number` | нумерация ideology-приказа | использовать существующую функцию (canonical), параметризовать scope под `package_template_id`/`session_id` в Sprint 3 |

---

## 9. Context-aware picker (Этап E, audit only)

Текущий `src/lib/tokens/tokenRegistry.ts` поддерживает контексты `messages` и `documents`. Контекстов `documents:billing` / `documents:package` / `documents:package:ideology` сейчас **нет**.

`TokenizedRichInput` (`src/components/admin/TokenizedRichInput.tsx`) принимает `tokenContext` пропсом и грузит группы через `loadTokensForContext(context)`. Архитектурно расширение существует, но без новых контекстов реальной фильтрации не будет.

**Sprint 2 design (без реализации):**

| контекст | какие category показывать |
|---|---|
| `documents:billing` (акты/счета) | customer.*, executor.*, deal, document, payment, offer, product, tariff, system, legal_details |
| `documents:package` (любой шаблон пакета) | package.*, system |
| `documents:package:ideology` (шаблоны идеологии) | package.*, ideology.*, system |

Изменения picker / `tokenRegistry.ts` / `TokenizedRichInput` в Sprint 2 **не делаются**. Шаблоны актов остаются на текущем контексте `documents` (без регрессии).

---

## 10. Package resolver design (Этап F, без wiring)

```text
input:  package_session_id (uuid), template_token_key (string)
output: resolved_value (string) | null

resolve(token_key, session_id):
  if token_key starts with "package.session." | "package.template." | "package.status"
    → read document_package_sessions row → field

  if token_key starts with "package.company."
    → read document_package_sessions.selected_legal_entity_id
    → join client_legal_details
    → map subfield (full_name, unp, bank_*, head.* …)

  if token_key matches "package.roles.<role_key>.<subfield>"
    → read document_package_session_participants WHERE session_id = ? AND role_key = ?
    → resolve participant by allowed_entity_type:
         person          → legal_details_persons
         legal_entity/ip → client_legal_details
    → map subfield

  if token_key starts with "ideology."
    → alias-таблица ideology_token_aliases (Sprint 3) или
      read document_package_sessions.meta->'ideology'

  if not resolved → return null (default-deny, в шаблон попадает пустая строка)
```

Routing по `template_scope`:

- `template_scope = 'billing' | 'document'` → existing billing resolver (БЕЗ изменений).
- `template_scope = 'package'` → package resolver (Sprint 3).
- `template_scope = 'package:ideology'` → package resolver + ideology aliases.

**Mapping `fields_registry` ↔ `document_token_registry`:**

Все новые ideology-токены в Sprint 3 будут создаваться **парой**:

1. Запись в `fields_registry` (если нет источника — отдельная новая запись с `source_strategy='package_resolver'`).
2. Запись в `document_token_registry` с `field_id` на эту запись + `category='package'` / `category='package.ideology'`.

В Sprint 2 эти записи **не создаются**.

---

## 11. Cleanup recommendation для «Нет источника данных (postponed)»

Sprint 2 НЕ меняет UI этой группы. Рекомендации для будущего sprint:

1. В UI ввести скрытие postponed-полей по умолчанию + toggle «Показать черновики токенов».
2. Будущие package-токены не помещать в общую postponed-группу — для них завести подгруппу «Пакеты документов / Черновики токенов» внутри namespace `documents:package`.
3. Поля без `source_strategy`, реально используемые в шаблонах, помечать в proof статусом `needs_source` и заводить отдельные задачи под их резолвер.
4. Физическое удаление полей запрещено.

---

## 12. Что остаётся deferred

| sprint | scope |
|---|---|
| Sprint 3 | реализация package-токенов: записи в `fields_registry` + `document_token_registry`, новые контексты picker'а, package resolver, RPC `package_session_replace_participants`, ideology aliases |
| Sprint 4 | генерация одного документа / всего пакета через `package_session_id` + snapshot в `ai_generated_documents.meta` |
| Sprint 4+ | массивы (`package.participants[]`, `ideology.activities[]`), повторяющиеся блоки в шаблонах |

---

## 13. No-write proof

Перечень запросов, выполненных в Sprint 2 — **только** `SELECT` / `information_schema`:

- `SELECT … FROM fields_registry WHERE entity_type='package'` (8 строк)
- `SELECT … FROM document_token_registry GROUP BY category` (18 строк)
- `SELECT … FROM document_token_registry WHERE category IN ('package','document','postponed') OR token_key ILIKE …`
- `SELECT … FROM document_templates WHERE placeholders::text ~ 'FLD-0000(93|94|95|96|97|98|101|102)' OR placeholders::text ILIKE '%package.%' …` → 0 строк
- `SELECT … FROM document_package_role_catalog WHERE package_template_id IN (SELECT id FROM document_package_templates WHERE code='ideology')` (11 строк)
- `SELECT column_name FROM information_schema.columns WHERE table_name IN (…)`

Запросов `INSERT` / `UPDATE` / `DELETE` / `ALTER` / `CREATE` в БД в Sprint 2 **НЕ выполнялось**.
Файлов в `src/` / `supabase/` Sprint 2 не менял. Изменены только два markdown-файла: этот proof и `.lovable/backlog/document_package_session_save_atomicity.md`.

### Code-path analysis по `save()`

Прочитан `src/hooks/useDocumentPackageSession.ts` (Sprint 1 артефакт):

- `delete` фильтруется по `session_id` (RLS обеспечивает scope владельца).
- Шаги выполняются последовательными `await` без транзакции.
- При ошибке `insert` возвращается throw в UI; session остаётся в БД без participants до следующего успешного `save()`.
- Это **подтверждает риск**, описанный в §2 и backlog `document_package_session_save_atomicity.md`.
- Failing-constraint тест в production НЕ запускался.

---

## 14. Final status

`completed: package placeholder namespace audited and designed; implementation deferred to Sprint 3`

DoD выполнен:

- ✅ Sprint 1 final UI verify внесён в proof как чек-лист, ожидает прогон.
- ✅ Hardening follow-up по `save()` зафиксирован в backlog.
- ✅ Inventory покрывает все 8 package-FLD, billing/customer/executor groups, postponed.
- ✅ Target structure «Пакеты документов» зафиксирована.
- ✅ Proposed ideology token list с источниками описан.
- ✅ Duplicate guard + conflict matrix построены (dry-run, без записи в БД).
- ✅ Package resolver design зафиксирован без wiring.
- ✅ Context-aware picker описан как design, без UI/registry правок.
- ✅ Cleanup postponed — только рекомендации, без UI правок.
- ✅ No-write proof: ни одна protected FLD не задета, ни один шаблон актов не изменён.
- ✅ Генерация документов не подключалась.
