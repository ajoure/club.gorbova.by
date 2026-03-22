

# ФИНАЛЬНЫЙ ЭТАЛОННЫЙ ПЛАН: модуль «Нейросеть → Реквизиты → AI-документы»

*Версия с учётом всех правок. Изменения относительно предыдущей версии помечены.*

---

## ADD-ONLY / NO-LOSS MAPPING

| Утверждённое решение | Где в PATCH-плане | Статус |
|---|---|---|
| `client_legal_details` = source of truth | Все PATCH | Сохранено |
| Модель A1: физлица и связи отдельно | PATCH 2 | Сохранено |
| Единый `generate-from-template` | PATCH 11 (расширение, не замена) | Сохранено |
| DOCX-only первый релиз | PATCH 10, 12 | Сохранено |
| AI не переписывает шаблон | PATCH 8, 9 | Сохранено |
| Связи только внутри карточки юрлица | PATCH 7 | Сохранено |
| Вкладки: Gorbova AI / Документы / Реквизиты | PATCH 4 | Сохранено |

**Не удаляется и не заменяется**: billing flow, MNS pipeline, `/settings/legal-details`, `executors`, `generate-from-template` (core), `generated_documents` (constraints — до PATCH 10.5).

---

## PATCH 0 — Архитектурный freeze + reuse map

Только документация. Код не пишем.

Deliverables: reuse matrix, список защищённых flows, mapping старое → новое, add-only scope.

DoD: документированный freeze, явный список «не трогать», mapping на текущие компоненты и edge functions.

---

## PATCH 1 — Диагностика `client_legal_details`: разграничение use-case

Только read-only аудит. DDL не утверждается.

Проверить все SELECT/INSERT/UPDATE по `is_default`, как `generate-from-template` выбирает `client_details_id`, как `/settings/legal-details` фильтрует записи. Определить, нужно ли одно поле `purpose`, два поля, enum, или иной вариант для разграничения billing / document / active / archive / default.

DoD: аудит зависимостей завершён, семантика зафиксирована, DDL-решение обосновано.

---

## PATCH 2 — Новые таблицы

5 миграций: `legal_details_persons`, `legal_details_roles_catalog`, `legal_details_positions_catalog`, `legal_details_entity_person_links`, `ai_chat_messages`.

**Уточнение unique constraint в `legal_details_entity_person_links`** *(правка)*:

Простой `UNIQUE (legal_details_id, person_id, role_catalog_id)` слишком грубый — `role_catalog_id = position` один для всех должностей, а различие идёт через `position_catalog_id` / `custom_position_text`.

Решение — составной constraint с учётом подтипа:

| role_type | Uniqueness rule |
|---|---|
| `founder` | UNIQUE (legal_details_id, person_id, role_catalog_id) — один founder-link на пару entity+person |
| `position` + catalog | UNIQUE (legal_details_id, person_id, role_catalog_id, position_catalog_id) — одна конкретная должность на пару |
| `position` + custom | UNIQUE (legal_details_id, person_id, role_catalog_id, custom_position_text) — одна custom-должность на пару |
| `other` | UNIQUE (legal_details_id, person_id, role_catalog_id, custom_role_text) — одна custom-роль на пару |

Реализация: вместо одного UNIQUE constraint — **partial unique indexes**:

```sql
-- founder: одна связь на пару entity+person
CREATE UNIQUE INDEX uq_link_founder
  ON legal_details_entity_person_links (legal_details_id, person_id, role_catalog_id)
  WHERE role_catalog_id IN (SELECT id FROM legal_details_roles_catalog WHERE role_type = 'founder');

-- position с catalog: одна должность из справочника на пару
CREATE UNIQUE INDEX uq_link_position_catalog
  ON legal_details_entity_person_links (legal_details_id, person_id, role_catalog_id, position_catalog_id)
  WHERE position_catalog_id IS NOT NULL;

-- position с custom text: одна custom-должность на пару
CREATE UNIQUE INDEX uq_link_position_custom
  ON legal_details_entity_person_links (legal_details_id, person_id, role_catalog_id, custom_position_text)
  WHERE position_catalog_id IS NULL AND custom_position_text IS NOT NULL;

-- other: одна custom-роль на пару
CREATE UNIQUE INDEX uq_link_other
  ON legal_details_entity_person_links (legal_details_id, person_id, role_catalog_id, custom_role_text)
  WHERE custom_role_text IS NOT NULL;
```

Это не блокирует валидные сценарии (одно лицо = и директор, и учредитель), но предотвращает exact duplicates.

DoD: миграции проходят, RLS работает, seed данные на месте, uniqueness корректна для всех role_type.

---

## PATCH 3 — Anti-duplicate + reuse GRP/Google flows

Последовательность для юрлиц/ИП: ввод УНП → `useGrpLookup` (reuse) → поиск existing у владельца → если найдена — открыть + предложить refresh через `GrpConfirmDialog` (reuse) → если нет — создать.

Правила антидубля для физлиц:
1. `personal_number` — если есть, матч по нему
2. Иначе `passport_series + passport_number`
3. Иначе soft warning по `full_name + birth_date`
4. AI перед созданием физлица обязан пройти через этот matching flow

DoD: повторный ввод УНП не создаёт дубль, используется существующий confirm/update сценарий.

---

## PATCH 4 — UI: вкладка «Реквизиты» в /ai

Add-only: `type Section = "ai" | "documents" | "requisites"`, подвкладки «Юрлица / ИП» и «Физлица», контент — placeholder-компоненты.

DoD: вкладка рендерится, старые разделы не сломаны.

---

## PATCH 5 — CRUD Юрлица/ИП

UX-логика: billing-записи видны с badge «Платёжные», **read-only в AI-разделе**, ссылка «Редактировать в настройках». Document-записи — полный CRUD.

DoD: CRUD работает, billing settings не затронуты, нет дублей по УНП, billing-запись не редактируется из AI-раздела.

---

## PATCH 6 — CRUD Физлица

Shared `PersonFieldsForm` (extracted из `IndividualDetailsForm`): full_name, birth_date, personal_number, passport_*, phone, email, address_*. Поля только в settings: bank_*, billing validation. Поля только в PersonForm: notes, is_active.

В карточке физлица: **read-only** список связанных компаний. Редактирование связей — только из карточки юрлица (PATCH 7).

DoD: CRUD работает, дубли предотвращаются, `IndividualDetailsForm` не сломан, связи read-only.

---

## PATCH 7 — Связи внутри карточки юрлица/ИП

`EntityPersonLinksBlock` внутри карточки. «Учредитель» = тип связи (founder), не должность. «Директор» = должность при role_type=position.

Явно зафиксировано: editing flow links — **только из карточки юрлица/ИП**. В карточке физлица — только read-only reference.

DoD: один person привязан к нескольким юрлицам, share_percent только для founder, position_catalog_id только для position, один person_id связан с несколькими legal_details_id.

---

## PATCH 8 — Реальный Gorbova AI chat

Edge function `gorbova-ai-chat` с SSE streaming (`google/gemini-3-flash-preview`), сохранение в `ai_chat_messages`, file upload через `fileExtractor.ts`. Никакого generic tool-calling. Text-in/text-out помощник.

DoD: чат отвечает реально, история сохраняется, setTimeout удалён.

---

## PATCH 9 — Interview flow (контролируемый, не agentic)

Structured UI wizard, не autonomous agent. Сценарии: добавить компанию, добавить физлицо, привязать, подготовить документ. AI помогает внутри interview (дозапрос, нормализация), но не создаёт сущности автономно.

DoD: AI ищет существующее перед созданием, missing fields дозапрашиваются, новые сущности — только через explicit UI action.

---

## PATCH 10 — 4 DOCX-шаблона + placeholder mapping

4 шаблона пакета «Годовое собрание»:
1. Приказ о проведении
2. Извещение о проведении
3. Список зарегистрированных лиц
4. Протокол

### Подход к повторяющимся данным (founders/participants) *(правка)*

**Первый релиз: docxtemplater loops (`{#array}...{/array}`)**, а не фиксированные `founder_1`, `founder_2`:

Обоснование: docxtemplater уже подключён в `generate-from-template` и нативно поддерживает loops. Фиксированные placeholders ломаются при N>max и оставляют мусор при N<max.

Формат данных для шаблона:
```javascript
placeholderData = {
  entity_name: "ООО «Рога и копыта»",
  director_name: "Иванов И.И.",
  meeting_date: "15 марта 2026 г.",
  // ... scalar fields ...
  founders: [
    { name: "Петров П.П.", share: "60%", passport: "..." },
    { name: "Сидоров С.С.", share: "40%", passport: "..." },
  ],
  participants: [
    { name: "Петров П.П.", registered: true },
    { name: "Сидоров С.С.", registered: true },
  ],
};
```

В DOCX-шаблоне:
```
{#founders}
{name} — доля {share}
{/founders}
```

**Ограничение первого релиза**: не ограничиваем число участников, но тестируем на 1–5.

### Источник данных для «Списка зарегистрированных лиц» *(правка)*

Это документ с табличной/повторяющейся структурой (таблица участников).

| Данные | Источник | Обязательность |
|---|---|---|
| Список участников | `legal_details_entity_person_links` WHERE role_type=founder для данного entity | required (min 1) |
| ФИО каждого | `legal_details_persons.full_name` через link | required |
| Доля каждого | `link.share_percent` | required |
| Паспортные данные | `legal_details_persons.passport_*` | required для данного шаблона |
| Статус регистрации | **manual selection в wizard** — пользователь отмечает, кто зарегистрирован | required |

Flow в wizard (PATCH 12):
1. Загрузить все founder-links для выбранного entity
2. Показать checklist — пользователь отмечает, кто зарегистрировался
3. Дозапросить missing данные (если у founder нет паспортных данных)
4. Сформировать массив `participants[]` для docxtemplater loop

### Placeholder mapping по шаблонам

**Шаблон 1: Приказ о проведении**

| Placeholder | Источник | Обязат. | Дозапрос |
|---|---|---|---|
| `{entity_name}` | `client_legal_details.leg_name` | да | нет |
| `{entity_org_form}` | `client_legal_details.leg_org_form` | да | нет |
| `{director_name}` | links(role=position, position=director) → person.full_name | да | если нет связи |
| `{director_position}` | link.position_title или positions_catalog.label | да | если нет |
| `{meeting_date}` | manual | да | да |
| `{meeting_time}` | manual | да | да |
| `{meeting_place}` | manual | да | да |
| `{agenda_items}` | manual | да | да |
| `{order_date}` | manual | да | да |
| `{order_number}` | manual | да | да |

**Шаблон 2: Извещение о проведении**

Те же scalar placeholders + loop `{#founders}...{/founders}` для списка уведомляемых лиц (ФИО, доля, адрес).

**Шаблон 3: Список зарегистрированных лиц**

| Placeholder | Источник | Обязат. | Дозапрос |
|---|---|---|---|
| `{entity_name}` | entity | да | нет |
| `{meeting_date}` | manual | да | да |
| `{#participants}` | founders links + manual checklist | да | если нет founders |
| `{participants.name}` | person.full_name | да | нет |
| `{participants.share}` | link.share_percent | да | если нет |
| `{participants.passport}` | person.passport_* (whitelist!) | да | если нет |
| `{participants.registered}` | manual checkbox | да | да |
| `{/participants}` | — | — | — |
| `{total_shares}` | sum(share_percent) зарегистрированных | да | авто |
| `{quorum_status}` | manual или авто (>50%) | да | авто/да |

**Шаблон 4: Протокол**

Scalar placeholders (entity, director, meeting_date/time/place) + `{#founders}` loop + `{#agenda_items}` loop + `{#decisions}` loop (manual input).

DoD: все 4 шаблона в Storage, placeholder mapping документирован, loops используют docxtemplater `{#array}...{/array}`, нет свободно генерируемых юридических блоков.

---

## PATCH 10.5 — Диагностика `generated_documents` / `order_id` / save flow

Read-only аудит. Код не меняем.

Проверить все зависимости `generated_documents.order_id`: FK, SELECT, JOIN, UI. Определить: nullable, surrogate session_id, или отдельная таблица `ai_generated_documents`.

DoD: все зависимости перечислены, решение обосновано.

---

## PATCH 11 — Расширение единого `generate-from-template` до `ai_document_mode`

Расширяем существующую edge function. Не создаём второй pipeline.

**Гарантия обратной совместимости** *(правка)*: если параметр `mode` не передан, поведение **строго текущее** (billing mode). Никаких изменений существующих billing-вызовов не требуется. `mode` = `'billing'` (default) | `'ai_document'`.

В `ai_document_mode`:
- Принимает: `template_id`, `client_details_id`, `person_link_ids[]`, `extra_fields`
- Собирает placeholderData из entity + persons + links + manual fields
- **Поддержка массивов** для docxtemplater loops: `founders[]`, `participants[]`, `agenda_items[]`, `decisions[]`
- Способ записи в `generated_documents` — по решению из PATCH 10.5

Reuse 1:1: docxtemplater render, PizZip, upload в Storage, save flow.

Только DOCX output. PDF и Excel — backlog/future.

DoD: старый billing mode не сломан (тест генерации счёт-акта), вызов без `mode` = текущее поведение, новый ai_document_mode работает через тот же pipeline.

---

## PATCH 12 — End-to-end «Годовое собрание»

UI wizard flow:
1. Выбор компании из своих entity
2. Проверка связанных лиц (director, founders) — из links
3. **Выбор участников** *(правка)*:
   - Показать всех founder-links для выбранного entity
   - Пользователь отмечает, кто участвует (checklist)
   - Пользователь выбирает/подтверждает:
     - кто **председатель** собрания (default = director)
     - кто **секретарь** (выбор из persons или manual ввод)
     - кто **подписант** документов (default = director)
   - Для «Списка зарегистрированных» — кто фактически зарегистрировался (checklist)
4. Дозапрос missing manual fields (дата, время, место, повестка, решения, кворум)
5. Вызов `generate-from-template` в `ai_document_mode` для каждого из 4 шаблонов
6. Результат — 4 DOCX для скачивания

Только DOCX output. PDF и Excel — future.

DoD: комплект генерируется, реквизиты подставляются, founders/participants формируются через links + manual selection, missing данные дозапрашиваются.

---

## PATCH 13 — Security hardening

Passport fields в AI prompt — только через **whitelist** (для каждого шаблона — явный список разрешённых полей). Audit logs на create/update/delete person и link. UI warning при создании физлица.

DoD: sensitive fields не уходят в AI без whitelist, audit на CUD есть, warning в UI.

---

## PATCH 14 — Regression / acceptance + reuse proof

Проверить:
- `/settings/legal-details` CRUD работает
- Billing генерация через `generate-from-template` без `mode` — работает как раньше
- MNS pipeline — работает
- `executors` — не затронуты
- `generated_documents` старые записи — работают

Reuse proofs:
- GRP lookup = тот же `grp-lookup` edge fn
- Google Maps = тот же `StructuredAddressBlock`
- Генерация = тот же `generate-from-template`
- Нет второго generator pipeline

**Дополнительные проверки** *(правка)*:
- Billing-запись **видна** в AI-разделе, но **не редактируется** там — редактирование только через `/settings/legal-details`
- Editing flow links идёт **только из карточки юрлица/ИП** — в карточке физлица связи read-only
- Повторный ввод УНП не создаёт дубль
- Повторное создание физлица не создаёт дубль по правилам матчинга
- Один person_id связан с несколькими legal_details_id

DoD: все старые и новые flows работают, reuse подтверждён.

---

## Порядок выполнения

```text
PATCH 0 → 1 → 2 → 3,4 (параллельно) → 5 → 6 → 7 → 8 → 9 → 10 → 10.5 → 11 → 12 → 13 → 14
```

Checkpoint перед PATCH 11: результат PATCH 10.5 подтверждён.

---

## Общий DoD проекта

- В /ai есть вкладка «Реквизиты» с подвкладками «Юрлица / ИП» и «Физлица»
- Связи реализованы **только внутри карточки юрлица** (не отдельной вкладкой)
- В карточке физлица — **только read-only reference** на связанные компании
- Billing-записи в AI-разделе — **read-only**, редактирование только через /settings
- `client_legal_details` остаётся source of truth
- Физлица и связи — отдельные таблицы
- Антидубль по УНП через существующий GRP flow
- Антидубль физлиц по personal_number / passport / soft warning
- AI chat реальный, не заглушка, не autonomous agent
- AI не пишет шаблон с нуля
- DOCX генерируется через единый `generate-from-template` (расширенный)
- Вызов без `mode` = текущее billing-поведение без изменений
- Нет второго generator pipeline
- Повторяющиеся блоки — через docxtemplater loops
- Первый пакет из 4 документов работает
- Billing flow не сломан
- `/settings/legal-details` не сломан
- MNS pipeline не сломан
- Audit и RLS на новых сущностях есть
- Sensitive fields в AI prompt только через whitelist
- Только DOCX output в первом релизе

---

После этих правок план считается **эталонным** для проверки выполненных PATCH-ов.

