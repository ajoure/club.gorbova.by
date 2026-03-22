# ФИНАЛЬНЫЙ ЭТАЛОННЫЙ ПЛАН: модуль «Нейросеть → Реквизиты → AI-документы»

*Версия с учётом всех правок. Утверждён пользователем.*

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

**Уточнение unique constraint в `legal_details_entity_person_links`**:

Простой `UNIQUE (legal_details_id, person_id, role_catalog_id)` слишком грубый — `role_catalog_id = position` один для всех должностей, а различие идёт через `position_catalog_id` / `custom_position_text`.

Решение — составной constraint с учётом подтипа:

| role_type | Uniqueness rule |
|---|---|
| `founder` | UNIQUE (legal_details_id, person_id, role_catalog_id) — один founder-link на пару entity+person |
| `position` + catalog | UNIQUE (legal_details_id, person_id, role_catalog_id, position_catalog_id) — одна конкретная должность на пару |
| `position` + custom | UNIQUE (legal_details_id, person_id, role_catalog_id, custom_position_text) — одна custom-должность на пару |
| `other` | UNIQUE (legal_details_id, person_id, role_catalog_id, custom_role_text) — одна custom-роль на пару |

Реализация — partial unique indexes.

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

Подход: docxtemplater loops (`{#array}...{/array}`), не фиксированные placeholders.

Источник данных для «Списка зарегистрированных лиц»: `legal_details_entity_person_links` WHERE role_type=founder + manual selection в wizard.

DoD: все 4 шаблона в Storage, placeholder mapping документирован, loops используют docxtemplater.

---

## PATCH 10.5 — Диагностика `generated_documents` / `order_id` / save flow

Read-only аудит. Код не меняем.

Проверить все зависимости `generated_documents.order_id`: FK, SELECT, JOIN, UI. Определить: nullable, surrogate session_id, или отдельная таблица.

DoD: все зависимости перечислены, решение обосновано.

---

## PATCH 11 — Расширение единого `generate-from-template` до `ai_document_mode`

Расширяем существующую edge function. Не создаём второй pipeline.

**Гарантия обратной совместимости**: если параметр `mode` не передан, поведение **строго текущее** (billing mode). `mode` = `'billing'` (default) | `'ai_document'`.

DoD: старый billing mode не сломан, вызов без `mode` = текущее поведение, новый ai_document_mode работает через тот же pipeline.

---

## PATCH 12 — End-to-end «Годовое собрание»

UI wizard: выбор компании → проверка связей → выбор участников (checklist) → председатель/секретарь/подписант → дозапрос manual fields → генерация 4 DOCX.

Только DOCX output. PDF и Excel — future.

DoD: комплект генерируется, реквизиты подставляются, missing данные дозапрашиваются.

---

## PATCH 13 — Security hardening

Passport fields в AI prompt — только через **whitelist**. Audit logs на CUD person и link. UI warning при создании физлица.

DoD: sensitive fields не уходят в AI без whitelist, audit на CUD есть, warning в UI.

---

## PATCH 14 — Regression / acceptance + reuse proof

Проверить: `/settings/legal-details`, billing generation, MNS pipeline, executors, generated_documents.

Дополнительные проверки:
- Billing-запись **видна** в AI-разделе, но **не редактируется** там
- Editing flow links — **только из карточки юрлица/ИП**
- Повторный ввод УНП не создаёт дубль
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
