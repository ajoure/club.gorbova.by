# да, согласен, с учетом правок:

1. **Уточнить, что Sprint 2 в основном read-only/design, а не cleanup в БД**
  &nbsp;
  В названии и цели лучше заменить формулировку:
  ```md
  Package placeholders registry cleanup
  ```
  на:
  ```md
  Package placeholders registry audit + namespace design
  ```
  Потому что по плану физически ничего не удаляем и почти ничего не меняем в registry. Иначе Lovable может воспринять `cleanup` как разрешение на правки `fields_registry`.
2. **Запретить запись в** `fields_registry` **в Sprint 2 полностью**
  &nbsp;
  Сейчас есть фраза:
  Не менять `fields_registry` без duplicate proof.
  Лучше жёстче:
3. **Уточнить Этап E: “минимальный фильтр” не делать без отдельного approve**
  &nbsp;
  Сейчас написано:
  Context-aware picker (только design + минимальный фильтр)
  Это может привести к UI-правкам picker-а. Лучше:
4. **Этап G не должен менять UI postponed-группы**
  &nbsp;
  Сейчас:
  UI: скрыть postponed по умолчанию или вынести…
  Это уже реализация. Для Sprint 2 лучше:
5. **Добавить проверку использования FLD не только в** `ai_generated_documents.meta.file_name_template_snapshot`
  &nbsp;
  В Этап A добавить:
6. **Добавить отдельную проверку Word-шаблонов**
  &nbsp;
  Так как акт выполненных работ реально использует `{{field:FLD-...}}`, нужно добавить:
7. **Развести** `document_token_registry` **и** `fields_registry`
  &nbsp;
  В плане они идут рядом, но нужно потребовать mapping:
8. **Добавить проверку “package FLD = корпоративные собрания”**
  &nbsp;
  Discovery уже показал, что существующие `package` FLD относятся к корпоративным собраниям. В Этап A добавить:
9. **Добавить** `no-write proof`
  &nbsp;
  В proof добавить секцию:
10. **Hardening по** `save()` **не тестировать через failing constraint, если это может затронуть данные**

В §2 фраза:

regression-тест на «отказ insert не оставляет пустой session» через failing constraint в dry-run

Лучше заменить:

```md
В Sprint 2 не ломать реальные данные и не создавать искусственные failing constraints в production. Проверку atomicity провести только как code-path analysis / local dry-run / test environment, если доступен. В production — только зафиксировать follow-up RPC.
```

11. **Уточнить финальный статус**

В §14 добавить:

```md
Если Sprint 2 выполнен полностью как read-only/design без registry/UI изменений:
`completed: package placeholder namespace audited and designed; implementation deferred to Sprint 3`
```

12. **Добавить запрет на “переименование групп”**

Чтобы не сломать текущий picker актов:

```md
В Sprint 2 запрещено переименовывать существующие группы плейсхолдеров:
- Заказчик ФЛ;
- Заказчик ЮЛ;
- Заказчик ИП;
- Исполнитель ЮЛ;
- Документ;
- Сделка;
- Оплата;
- Системные поля;
- Технические / override.
Все предложения по переименованию — только в proof.
```

После этих правок план безопасный. Главная корректировка: **Sprint 2 должен быть аудитом и проектированием namespace, без фактических правок registry/picker/resolver**.

&nbsp;

План: Sprint 2 — Package placeholders registry cleanup + ideology token namespace

## 0. Правила исполнения

- Все артефакты (план, отчет, proof, комментарии в коде/SQL) — только на русском.
- Порядок: DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY. Пропуск этапов запрещён.
- Add-only. Все связи только через UUID/id. Связи по названию/УНП/email/slug/тексту запрещены.
- НЕ трогать: `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `tariff_offers`, `allocate_document_number`, `document_scenarios`, Contact Center, морфологию, refund/access-repair, billing/customer/executor resolver, existing FLD-токены актов, `canonical-document-generate-strict` signature.
- Генерация документов в этом sprint НЕ подключается.
- Перед Sprint 2 — короткий final UI verify Sprint 1 (см. §1) и hardening-замечание по `save()` (см. §2).

---

## 1. Pre-Sprint: Final UI verify Sprint 1

Перед стартом Sprint 2 закрыть Sprint 1 чек-листом и приложить результат в proof Sprint 1:

1. `/ai` и `/admin/ai` — видна только Gorbova AI, документов нет.
2. `/admin/documents` — нет дубля вкладки «Документы»; присутствуют: Плейсхолдеры / Шаблоны / Пакеты документов / История / Исполнители.
3. `/admin/documents → Пакеты документов → Идеология` — пакет открывается.
4. `/document-generation → Идеология`:
  - бейджа «локально» нет;
  - юрлицо/ИП single-select;
  - после reload выбор сохраняется;
  - физлицам назначаются роли из `document_package_role_catalog`;
  - required checklist работает;
  - статус: «Сохранено» / «Требует заполнения».
5. Incognito/другой браузер — данные подтягиваются из backend (не из localStorage).
6. RLS — чужие реквизиты/sessions/participants не видны.
7. Кнопка «Сформировать пакет» disabled с понятным пояснением (генерация — Sprint 4).
8. Результаты добавить в `package_documents_ideology_sprint1_persisted_session_2026_05.md`.

## 2. Hardening-замечание Sprint 1 (фиксируем как follow-up)

`save()` сейчас = upsert session + delete-then-insert participants на клиенте через supabase-js. Зафиксировать в backlog (`document_package_session_save_atomicity.md`):

- `delete` обязан фильтроваться по `package_session_id` владельца (RLS уже это гарантирует — подтвердить тестом).
- При ошибке `insert` — session не должна остаться без participants (риск пустого состояния).
- Целевое решение: RPC `package_session_replace_participants(session_id, participants[])` в одной транзакции.
- В Sprint 2 RPC НЕ внедряется — только фиксируется follow-up + добавляется regression-тест на «отказ insert не оставляет пустой session» (через failing constraint в dry-run).

---

## 3. Цель Sprint 2

Привести в порядок package placeholders и подготовить namespace + resolver design для пакетов документов (в первую очередь «Идеология»), не сломав акты выполненных работ.

Итог:

1. В `/admin/documents → Плейсхолдеры` появляется верхнеуровневая группа **«Пакеты документов»** с подгруппами:
  - Общие поля пакета;
  - Компания пакета;
  - Роли пакета;
  - Физлица пакета (массивы);
  - Пакет «Идеология».
2. Для «Идеологии» определён proposed token list с понятным источником.
3. Все новые токены — в namespace `documents:package` и `documents:package:ideology`.
4. Existing billing/customer/executor tokens **не изменены**.
5. Генерация документов не подключена.

---

## 4. Этап A — Discovery текущих package placeholders

Read-only выборки:

1. `fields_registry`: `entity_type='package'`; label содержит «пакет/участник/идеология»; group/category содержит `package`.
2. `document_token_registry`: записи с category/context `package`, `document`, `postponed`.
3. Все «postponed / нет источника» поля: причина, где используются, можно ли скрыть.
4. Использование package-FLD в `document_templates`, file templates, token manifests, `ai_generated_documents.meta.file_name_template_snapshot`.

Сформировать таблицу в proof:


| FLD | label | entity_type | group/category | source | в шаблонах | статус | решение |
| --- | ----- | ----------- | -------------- | ------ | ---------- | ------ | ------- |


Решения: `keep_as_is` / `move_to_package_general` / `move_to_ideology` / `hide_as_postponed` / `deprecated_do_not_use` / `needs_source` / `conflict_with_billing_token`.

## 5. Этап B — Защита актов выполненных работ

Зафиксировать **protected groups** (изменения запрещены: FLD-ID, label, source mapping, resolver, token format, category/group, падежи, formatting, billing resolver):

- Заказчик ФЛ / ЮЛ / ИП
- Исполнитель ЮЛ
- Документ / Сделка / Оплата
- Системные / Технические / override

Proof-таблица:


| protected FLD | label | group | используется в billing template | action    |
| ------------- | ----- | ----- | ------------------------------- | --------- |
| FLD-…         | …     | …     | yes                             | no change |


DoD: доказать, что Sprint 2 не задевает ни один protected FLD.

## 6. Этап C — Целевая структура package placeholders

```text
Пакеты документов
  1. Общие поля пакета     → package.session.*, package.template.*, package.status, package.created_at
  2. Компания пакета       → package.company.* (head: full_name/position/authority_basis)
  3. Роли пакета           → package.roles.<role_key>.full_name|position|phone|email|authority_basis
  4. Физлица пакета (arr)  → package.participants[], package.notified_persons[], package.ideology_active_members[]
  5. Пакет «Идеология»     → ideology.order.*, ideology.plan.*, ideology.responsible.*,
                              ideology.components.list, ideology.activities[]
```

Источники:

- `document_package_sessions.selected_legal_entity_id → client_legal_details`
- `document_package_session_participants + document_package_role_catalog + legal_details_persons`

Правила:

- если source/resolver не готов — proposed token остаётся в proof как `postponed`, в registry **не пишется**;
- запрещено смешивать с billing tokens;
- любые массивы (`[]`) описываются как future-feature (Sprint 3+), в registry в Sprint 2 не материализуются.

## 7. Этап D — Duplicate guard

Перед добавлением любого токена:

- exact canonical key duplicate;
- exact system token duplicate;
- exact/fuzzy label duplicate;
- конфликт с billing/customer/executor/existing package токеном.

Proof-таблица:


| proposed token | duplicate found | conflict type | action |
| -------------- | --------------- | ------------- | ------ |


При конфликте — токен **не создаётся**, решение фиксируется письменно.

## 8. Этап E — Context-aware picker (только design + минимальный фильтр)

Контексты:

- `documents:billing`, `documents:order`, `documents:payment` — для актов;
- `documents:package` — общие package;
- `documents:package:ideology` — для шаблонов «Идеологии».

Правило: шаблон акта видит billing/customer/executor; шаблон пакета — package; шаблон «Идеологии» — package + ideology.

Если текущий `tokenRegistry.ts` / `TokenizedRichInput` не поддерживает context filtering — Sprint 2 ограничивается **discovery + UI plan**, без переключения шаблонов актов.

## 9. Этап F — Resolver design (без wiring)

Описать (не подключать) package resolver:

```text
package_session_id
  → document_package_sessions → selected_legal_entity_id → client_legal_details
  → document_package_session_participants
       → document_package_role_catalog.role_key
       → legal_details_persons / client_legal_details
```

Routing по template context:

- billing template → billing resolver (без изменений);
- package template → package resolver;
- ideology template → package resolver + ideology role map.

В Sprint 2 generation не подключается; helper можно подготовить только если он не импортируется ни одной рабочей цепочкой.

## 10. Этап G — Cleanup группы «Нет источника данных (postponed)»

Разобрать содержимое:

- отложенные billing fields;
- будущие package fields;
- технические/мусор;
- поля без source, уже используемые в шаблонах (→ помечать `needs_source`).

UI: скрыть postponed по умолчанию или вынести в отдельную подгруппу «Черновики токенов» внутри «Пакеты документов». **Физически ничего не удалять.**

## 11. Что НЕ делать

- Не генерировать документы; не менять `canonical-document-generate-strict`.
- Не менять billing resolver и existing billing FLD.
- Не удалять старые/postponed токены.
- Не менять `fields_registry` без duplicate proof.
- Не создавать role-token placeholders без resolver/source proof.
- Не трогать payments/orders/subscriptions/entitlements/access.

## 12. Proof

Файл: `.lovable/proofs/package_documents_ideology_sprint2_placeholder_namespace_2026_05.md`

Секции:

1. Sprint 1 final UI verify (перенести из §1).
2. Hardening follow-up по `save()` (§2).
3. Inventory: billing / customer / executor / package / postponed placeholders.
4. Billing protected FLD list.
5. Target structure «Пакеты документов».
6. Proposed ideology token list (с источниками).
7. Duplicate guard results.
8. Conflict matrix.
9. Context-aware picker analysis.
10. Package resolver separation design.
11. Cleanup recommendation для postponed.
12. What remains deferred (Sprint 3 — реализация tokens+resolver; Sprint 4 — генерация).
13. Final status.

## 13. DoD

- Sprint 1 final UI verify приложен.
- Hardening follow-up по `save()` зафиксирован в backlog.
- Ясно, какие FLD принадлежат актам, какие — package, какие — мусор.
- Есть целевая структура группы «Пакеты документов».
- Есть proposed token list для «Идеологии» с источниками.
- Есть duplicate guard + conflict matrix.
- Есть решение по picker context separation (минимум — design).
- Есть package resolver design (без wiring).
- Акты выполненных работ не сломаны (доказано таблицей protected FLD).
- Генерация документов не подключалась.

## 14. Финальный статус

- Все DoD выполнены → `completed: package placeholder namespace designed; generation still deferred`.
- Picker/registry требует реализации → `partial: namespace designed, implementation patch required`.
- Найден риск регрессии актов → `blocked: billing regression risk`.

## 15. Затронутые сущности (read/inventory only)

- Таблицы: `fields_registry`, `document_token_registry`, `document_token_aliases`, `document_templates`, `document_package_templates`, `document_package_sessions`, `document_package_session_participants`, `document_package_role_catalog`, `client_legal_details`, `legal_details_persons`, `ai_generated_documents` (meta-снапшоты).
- UI: `src/pages/admin/AdminDocuments.tsx`, `src/components/ai-documents/*`, `src/components/admin/TokenizedRichInput.tsx`, `src/lib/tokens/tokenRegistry.ts`.
- Edge functions: только read; `canonical-document-generate-strict` не меняется.

## 16. Дорожная карта после Sprint 2

- Sprint 3 — реализация package tokens + package resolver (по утверждённому в Sprint 2 namespace).
- Sprint 4 — генерация одного документа / всего пакета через `package_session_id` + snapshot.