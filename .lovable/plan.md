да, согласен, с учетом правок:

1. **Добавить явное требование по языку**
  &nbsp;
  В начало плана вставить:
2. **Уточнить STOP-guard про localStorage**
  &nbsp;
  Сейчас написано: «остановиться и НЕ предлагать implementation plan, если localStorage SOT».  
  Нужно точнее:
3. **Добавить проверку ownership не только через** `profile_id`**, но и через фактический user/access path**
  &nbsp;
  В Этап 1 добавить:
4. **Добавить проверку “одно юрлицо на один оплаченный пакет”**
  &nbsp;
  В Этап 3 или 4 добавить отдельный блок:
5. **Добавить проверку lock/unlock модели**
  &nbsp;
  В Этап 4 добавить:
6. **Расширить Этап 5 по placeholder registry**
  &nbsp;
  Добавить проверку массивов/ролей:
7. **Добавить проверку template requirements**
  &nbsp;
  В Этап 6/7 добавить:
8. **Уточнить, что package-role ≠ company-role**
  &nbsp;
  В Этап 2 добавить:
9. **Добавить проверку генерации “один документ / весь пакет”**
  &nbsp;
  В Этап 6 добавить:
10. **Добавить проверку доступа клиента к шаблонам**

В Этап 3 добавить:

```md
Проверить, может ли клиент видеть только шаблоны тех пакетов, к которым у него есть entitlement/access.
Проверить, нет ли возможности открыть package_template_id напрямую через URL без доступа.
```

11. **Добавить проверку RLS не только таблиц реквизитов, но и package tables**

В метод `supabase--read_query` добавить:

```md
Проверить RLS policies и GRANTs для:
- document_package_templates;
- document_package_template_items;
- ai_document_generation_batches;
- ai_generated_documents;
- client_legal_details;
- legal_details_persons;
- legal_details_entity_person_links.
```

12. **Добавить проверку “локально” на скринах**

В Этап 4 добавить:

```md
Найти точный компонент, который показывает бейдж «локально».
Зафиксировать:
- файл;
- state management;
- localStorage key, если есть;
- какие данные теряются при смене браузера;
- влияет ли localStorage на генерацию или только на UI preview.
```

13. **Добавить итоговую архитектурную схему в proof**

В артефакт добавить секцию:

```md
17. Proposed data flow diagram

В ней описать цепочку:
entitlement/order → package_template → package_session → selected_legal_entity_id → package_participants/roles → token resolver → generated_documents snapshot.
```

14. **Уточнить DoD**

В DoD добавить:

```md
- Отдельно указано: можно ли Sprint 1 сделать без новых таблиц или новые таблицы неизбежны.
- Если новые таблицы нужны — перечислены минимальные сущности, но без SQL.
- Есть recommendation: reuse existing vs create new, с аргументацией.
- Есть список файлов/таблиц, которые точно нельзя трогать в Sprint 1.
```

15. **Финальный статус discovery**

В формат отчета добавить:

```md
Финальный статус должен быть одним из:
- discovery completed, Sprint 1 can be planned;
- discovery completed, blockers found;
- discovery incomplete, missing access/data.
```

В остальном план корректный: это именно discovery, а не реализация. Главное — не останавливать сам discovery из-за localStorage, а зафиксировать это как production-blocker и основание для Sprint 1.

&nbsp;

План: Discovery модуля пакетов документов, реквизитов, ролей и placeholder registry

## Режим работы

Строго read-only discovery. Без миграций, без изменений RLS, без правок edge functions, без UI-правок, без создания новых таблиц. Все связи анализируются только через UUID. Результат — один proof-документ + рекомендация по следующему sprint (без его исполнения).

## Цель

Зафиксировать текущее состояние слоёв «реквизиты → пакет → роли → шаблоны → генерация → snapshot» в проекте и ответить на 15 вопросов из задания, чтобы определить минимальный sprint для перевода пакета «Идеология» с локальной анкеты на persisted package session.

## Этапы discovery

### Этап 1 — Реквизиты (юрлица/ИП и физлица)

- Таблицы: `client_legal_details` (purpose=document, client_type ∈ legal_entity/entrepreneur), `legal_details_persons`, link-слой `legal_details_entity_person_links`.
- Хуки: `useAiEntities`, `useAiPersons`, `useEntityPersonLinks`, `useLegalDetails`, `useRequisitesV2`.
- UI: `src/components/ai-requisites/*`, `src/components/legal-details/*`, `src/pages/settings/UserRequisites.tsx`.
- Проверить: поля, ownership (`profile_id`), RLS-изоляцию (`has_table_privilege` + policy text), наличие default/primary, archived/active.

### Этап 2 — Связь физлицо ↔ юрлицо

- Изучить `legal_details_entity_person_links`: какие роли уже моделируются (директор, подписант и т.п.), хранится ли позиция/полномочия, есть ли UI для назначения.
- Зафиксировать: достаточно ли link-слоя для package-roles или нужен отдельный слой package-participant-role (без создания).

### Этап 3 — Пакеты документов и шаблоны

- Таблицы: `document_package_templates`, `document_package_template_items`, `document_templates`, `ai_document_generation_batches`.
- Хук: `useDocumentPackages`, `useAiDocumentPackageGeneration`, `useCorporatePackageGeneration`.
- Найти пакет «Идеология»: где хранится, какие шаблоны привязаны, как ordering/required.
- Доступ клиента к пакету: проверить связь `product_id` / `tariff_id` / `entitlements` / `access_rules` → package_template; есть ли явная привязка или пакет открыт всем.

### Этап 4 — Текущая «Анкета пакета» (blocker check)

- Найти компонент с бейджем «локально», определить storage (localStorage vs backend).
- Проверить: есть ли таблица package_session / draft, сохраняются ли selected_legal_entity_id и participants/roles, есть ли FK на `client_legal_details` / `legal_details_persons`.
- Зафиксировать как blocker, если SOT = localStorage.

### Этап 5 — Token / placeholder registry

- Таблицы: `fields_registry` (по `useLegalDetailsFields`), token catalog, RPC для резолва.
- Проверить существующие contexts (documents, messages, payment, order, contact, executor) и возможность расширения до `documents:package` без новых таблиц.
- Duplicate guard: exact key, system token, fuzzy label.
- Зафиксировать formats: `{{cf.legal_details.FLD-XXXXXX}}` уже canonical (см. memory `document-file-name-template-fld-first`).

### Этап 6 — Generation pipeline и snapshot

- Edge functions: `canonical-document-generate-strict`, любые legacy generator-ы (через `supabase/functions.registry.txt`).
- Таблицы snapshot: `ai_generated_documents`, `ai_document_generation_batches.meta`.
- Проверить, как pipeline получает контекст (token context resolver), может ли принять package_session_id.

### Этап 7 — Админский UI

- `src/pages/admin/AdminDocuments.tsx`, `AdminProductsDocs.tsx`, package builder UI: создание пакета, добавление шаблонов, настройка ролей, preview required fields.

### Этап 8 — Клиентский UI

- `src/pages/DocumentGeneration.tsx` → `AiPageContent` (mode=user, section=doc-packages).
- Текущий маршрут «открыть пакет → анкета → генерация», точки касания localStorage.

## Метод

1. `code--view` ключевых файлов (hooks, AiPageContent, package UI, edge functions registry).
2. `supabase--read_query` для:
  - перечисления RLS policies на таблицах из этапов 1–4,
  - `has_table_privilege` для anon/authenticated/service_role,
  - выборки пакета «Идеология» (`document_package_templates` + items),
  - проверки существования таблиц `package_session*`, `package_role*`, `package_participant*`.
3. `rg` поиск: `localStorage`, `package_session`, `selected_legal_entity`, `ideology`, `participant_role`.
4. Все находки складываем в один proof.

## Артефакт

`.lovable/proofs/package_documents_ideology_discovery_2026_05.md` с 16 секциями строго по ТЗ (Current UI → Recommended implementation plan) и ответами на 15 вопросов.

## Отчёт

Формат: `Отчет о выполненной работе: discovery модуля пакетов документов, реквизитов, ролей и placeholder registry`, на русском, 14 пунктов из ТЗ.

## STOP-guards

Остановиться и НЕ предлагать implementation plan, если выполняется любое из условий §9 ТЗ (неизвестен access path, localStorage SOT, нет token registry, нет RLS-изоляции, требуется новая таблица без отдельного согласования).

## Что НЕ делаем

- Никаких миграций, edge function deploys, изменений config.toml.
- Никаких новых таблиц/placeholder-ов.
- Не трогаем `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, document scenarios, allocate_document_number, Contact Center, морфологию.
- Не предлагаем хранить связи по названию/УНП/email/slug.

## DoD

- Proof создан, все 16 секций заполнены.
- 15 вопросов имеют явные ответы (или помечены как gap с указанием места проверки).
- Перечислены blocker-ы (особенно localStorage анкеты).
- Описан минимальный Sprint 1 (persisted package setup) — только описание, без кода.
- Отчёт на русском в требуемом формате.