# B+C Dry-run отчёт: tenant foundation + новые таблицы реквизитов

Read-only прогон перед `supabase--migration`. Цифры — фактические, на момент запуска. Если на execute-фазе snapshot изменится, STOP-guard в SQL остановит транзакцию.

---

## §1. Источник миграции (`purpose='billing'` → `scope='system_customer'`)

| `client_type`   | строк к переносу | `is_default=true` | `is_default=false` |
|-----------------|------------------|-------------------|--------------------|
| `entrepreneur`  | 8                | 7                 | 1                  |
| `individual`    | 10               | 9                 | 1                  |
| `legal_entity`  | 3                | 2                 | 1                  |
| **итого**       | **21**           | **18**            | **3**              |

`legal_entity` + `entrepreneur` → `legal_entities_requisites` (**11 строк**).
`individual` → `individual_requisites` (**10 строк**).

## §2. Резолв `profile_id → user_id` для billing-строк

| billing-строк | resolvable | UNRESOLVABLE |
|---|---|---|
| 21 | **21** | **0** |

Все billing-записи имеют `profiles.user_id IS NOT NULL`. Backfill `owner_user_id` 100%.

## §3. Конфликты `is_default` внутри `(profile_id, client_type)` для billing

Запрос `count(*) FILTER (WHERE is_default) > 1` по `(profile_id, client_type)` — **0 строк**. Partial unique будет создан без миграционных конфликтов.

## §4. Кандидаты на удаление (после переноса billing)

| Источник                                       | строк к удалению |
|------------------------------------------------|------------------|
| `client_legal_details` `purpose='document'`    | **5**            |
| `client_legal_details` `purpose='billing'` (после миграции) | **21** |
| `legal_details_persons`                        | **7**            |
| `legal_details_entity_person_links`            | **1**            |
| `fields_registry` `entity_type='entity'`       | **6**            |
| `fields_registry` `entity_type='person'`       | **12**           |
| `fields_registry` `entity_type='entity_person'`| **6**            |

## §5. Tenant foundation — ожидаемые counts

- `auth.users`: **255**
- `profiles` всего: **11 884**
- `profiles` с `user_id IS NOT NULL`: **236**

Выбор: **personal tenant создаём по `auth.users` (255 шт.)**, не по `profiles`. Профили без `user_id` — это анонимные контакты CRM, реквизитов у них нет и быть не может; tenant им не нужен.

Ожидаемые counts после execute:

| Таблица              | INSERT |
|----------------------|--------|
| `tenants`            | 255    |
| `tenant_memberships` | 255 (`role='owner'`, `is_active=true`) |
| `legal_entities_requisites` | 11 (миграция billing-строк ЮЛ+ИП) |
| `individual_requisites`     | 10 (миграция billing-строк ФЛ) |

Backfill `tenant_id` для каждой новой строки реквизитов = personal tenant владельца (`tenants.owner_user_id = profiles.user_id` billing-строки).

## §6. Production-зависимости в строках на удаление (должны быть **0**)

| Связь | строк |
|---|---|
| `ai_generated_documents.legal_details_id` → `client_legal_details(purpose='document')` | **0** |
| `ai_generated_documents.person_id` → `legal_details_persons` | **0** |
| `ai_generated_documents.signer_person_id` → `legal_details_persons` | **0** |
| `ai_generated_documents.signer_link_id` → `links` | **0** |
| `generated_documents.client_details_id` → `client_legal_details` | **0** |

## §7. Использование старых entity/person/entity_person FLD-IDs в шаблонах/документах

Регексп `FLD-0000(8[4-9]|6[3-8]|5[1-9]|6[0-2])` — диапазоны `entity` (84-89), `entity_person` (63-68), `person` (51-62):

| Источник | строк |
|---|---|
| `document_template_versions.editor_html` | **0** |
| `document_template_versions.markup_draft` | **0** |
| `document_template_versions.tokens` | **0** |
| `document_template_versions.detected_tokens` | **0** |
| `ai_generated_documents.token_manifest_snapshot|template_tokens_snapshot` | **0** |

Старые FLD-ID не упомянуты ни в одном шаблоне или документе → удаление 24 записей `fields_registry` безопасно.

## §8. Поправка к Discovery-отчёту (§5)

При повторной выгрузке `pg_policies` поле `with_check` для INSERT-политик `client_legal_details`/`legal_details_persons`/`legal_details_entity_person_links` оказалось **не NULL** — `with_check = (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))`. То есть «дыры в INSERT» как таковой нет — INSERT уже привязан к owner. В новой модели всё равно меняем формулу на `owner_user_id = auth.uid() AND tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() AND is_active)`.

---

## §9. STOP-guards для execute-миграции

Транзакция должна `RAISE EXCEPTION` (откат всей миграции), если:

1. `(SELECT count(*) FROM auth.users) <> (SELECT count(*) FROM tenants WHERE owner_user_id IS NOT NULL)` → tenant per user не создан.
2. `(SELECT count(*) FROM tenant_memberships) <> (SELECT count(*) FROM tenants)` → membership per tenant не создан.
3. `(SELECT count(*) FROM client_legal_details WHERE purpose='billing') <> (SELECT count(*) FROM legal_entities_requisites WHERE scope='system_customer') + (SELECT count(*) FROM individual_requisites WHERE scope='system_customer')` → миграция billing неполная.
4. `EXISTS (SELECT 1 FROM legal_entities_requisites WHERE tenant_id IS NULL OR owner_user_id IS NULL)` → tenant_id/owner_user_id повисли NULL.
5. То же для `individual_requisites`.
6. Любая billing-строка с `profiles.user_id IS NULL` → `RAISE EXCEPTION 'unresolvable profile %', profile_id`.

В этой миграции `purpose='billing'` **НЕ удаляется** — только переносится. Удаление billing- и document-строк, persons, links, registry-записей `entity/person/entity_person` — отдельной миграцией этапа **E** после переключения UI/edge-функций (этапы F/G).

---

## §10. DoD dry-run

- [x] Все counts собраны и зафиксированы.
- [x] `profile_id → user_id` 100% резолвится.
- [x] Конфликтов `is_default` нет.
- [x] Production-зависимостей в кандидатах на удаление — 0.
- [x] Шаблоны не используют старые entity/person FLD-ID.
- [x] STOP-guards сформулированы.
- [x] Решение по «один tenant на user» (255), не «на profile» (11 884).

**Готов к execute.** Миграция B+C должна:

1. Создать `tenants`, `tenant_memberships` + RLS.
2. Backfill: 1 personal tenant + 1 owner-membership на каждого `auth.users`.
3. Создать `legal_entities_requisites`, `individual_requisites` + индексы + триггеры + RLS.
4. Перенести 11 + 10 billing-строк со `scope='system_customer'`.
5. Применить STOP-guards.
6. Закрыть транзакцию, оставив старые таблицы и `purpose='billing'` записи **на месте** (read-only канон ещё не подтверждён переключением читателей).
