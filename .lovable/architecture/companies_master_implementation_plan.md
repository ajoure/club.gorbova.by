# CRM Companies — Master Implementation Plan (v2)

Дата: 2026-07-07. Версия v2 — принята правка про billing-only источник (см. §3.1).

Документ описывает **весь путь внедрения canonical-сущности `companies`** по фазам. Каждая фаза запускается отдельным approval — этот документ **не является runnable планом Phase 1**.

Связанные документы:
- [Discovery 0.1](./companies_sprint_discovery_0_1.md)
- [SQL proofs](../proofs/companies_discovery_0_1_sql.md)
- [Dependency map](../proofs/companies_dependency_map_0_1.md)

## 1. Executive summary

Задача: вывести юрлица/ИП в отдельную сущность CRM, чтобы:
- звонить и вести задачи по компании (даже без сделки);
- видеть все контакты компании (директор, бухгалтер, подписант);
- корректно связывать сделки/оплаты/документы с компанией;
- дать call-центру базу для прозвона (импорт CSV/XLSX);
- не ломать существующие ЛК-реквизиты, доступы, документы, платежи.

Стратегия: **add-only + billing-only source**. Никаких breaking-изменений в `profiles`, `entitlements`, `telegram_*`, `payments_v2`, `orders_v2` writer-flows. Compat-layer через `client_legal_details` сохраняется минимум до Phase 10. `companies` — это CRM-слой поверх **billing-реквизитов ЛК**, а не замена document/billing storage.

## 2. Итоговая архитектура

```text
                   ┌──────────────┐          ┌──────────────────────┐
                   │   companies  │◄─────────┤ client_legal_details │  (compat SOT)
                   └──────┬───────┘   1:N    │  purpose='billing'   │
                          │      via map     │  legal_entity / ИП   │
                          │                  └──────────────────────┘
              1:N (company_contacts)                    ▲
                          │                             │ mirror only
                          ▼                             │ if source_legacy_id
                   ┌──────────────┐          ┌──────────────────────┐
                   │   profiles   │          │ legal_entities_      │
                   └──────┬───────┘          │   requisites         │
                          │                  └──────────────────────┘
                          │ (entitlements / telegram / access — ТОЛЬКО здесь)
                          ▼
                   ┌──────────────┐
                   │ entitlements │
                   └──────────────┘

orders_v2.company_id (nullable) ──► companies                    Phase 5
crm_tasks.company_id (nullable)  ──► companies                    Phase 6
calls.company_id (nullable)      ──► companies                    Phase 6
ai_generated_documents.context_type='company' (feature-flag)      Phase 10

EXCLUDED FROM CRM AUTO-SOURCE (document compat only):
  client_legal_details.purpose='document'
  client_legal_details.client_type='individual'
  legal_details_persons
  legal_details_entity_person_links
```

## 3. Что остаётся legacy / compat-layer

- `client_legal_details` — SOT реквизитов ЛК. Читается всеми document-flows. Не удаляется, не заменяется.
- `legal_entities_requisites` — secondary mirror поверх ЛК (`source_legacy_id`). **Самостоятельным источником CRM companies не является.** Если `source_legacy_id` отсутствует → excluded from CRM auto-source.
- `legal_details_persons` + `legal_details_entity_person_links` — исключительно для пакетов документов / ролей подписантов. **Не участвуют в CRM auto-source** (не создают companies, не создают company_contacts, не участвуют в auto-dedupe).
- `generated_documents` (legacy) — deprecated в UI, только audit.

## 3.1 Source rules (обязательно, принято в v2)

**Единственный auto-источник CRM companies:**

```sql
client_legal_details.purpose = 'billing'
AND client_legal_details.client_type IN ('legal_entity', 'entrepreneur')
```

Правила (10 пунктов):

1. Для автоматического создания / backfill / sync canonical `companies` использовать **только** билинговые реквизиты юрлиц/ИП из ЛК.
2. Реквизиты с `purpose='document'` **не использовать** для автоматического создания companies. Причина: document-реквизиты могут быть чужими контрагентами, тестовыми данными, реквизитами для генерации договоров и не означают, что эта компания является компанией клиента или должна попасть в базу прозвона.
3. `legal_entities_requisites` учитывается **только** если через `source_legacy_id` ссылается на `client_legal_details` с `purpose='billing' AND client_type IN ('legal_entity','entrepreneur')`. Без `source_legacy_id` — excluded.
4. Все `purpose='document'` реквизиты остаются в document compatibility layer:
   - не создают company автоматически;
   - не создают company_contact автоматически;
   - не участвуют в базе прозвона;
   - не участвуют в auto-dedupe CRM companies;
   - не перезаписывают карточку `companies`;
   - могут быть связаны с company **только** вручную админом или через отдельный approved matcher в будущей фазе.
5. Phase 3 Backfill: source guard — только billing legal_entity/entrepreneur. Excluded → в dry-run отчёт с explicit reason.
6. Phase 4 ЛК→Company sync: guard в RPC — если не billing legal_entity/entrepreneur, sync завершается `skip` без создания company (не ошибка).
7. Совпадение УНП: existing company не пересоздаётся, критичные поля не перезаписываются, создаётся дополнительный `client_legal_details_company_map` + billing_contact. Details — §6.4 (Phase 4).
8. В UI карточки компании во вкладке «Контакты» показывать `source` связи: `billing_requisites` / `manual` / `import` / `call_center` / `admin_link` / `document_review`.
9. `client_legal_details` не удаляется и не заменяется — working compat SOT для billing и document процессов. `companies` = canonical CRM layer **поверх** billing-реквизитов, а не замена storage.
10. Закрытый список таблиц юрлиц (см. §4). Любая новая параллельная таблица по юрлицам — запрещена без отдельного duplicate discovery + approval.

**Discovery-обоснование:** `legal_details_persons.profile_id` = владелец ЛК-карточки, а не подписант (доказано в Discovery 0.1 §3 + `proofs §2.2`). Поэтому LDP / LEPL не могут служить источником CRM company_contacts.

## 4. Что создаётся новое

**Закрытый список таблиц Phase 1 core (только для CRM Companies core):**

- `companies` — canonical компания/ИП/юрлицо, `public_id` формата `CMP-000001`.
- `company_contacts` — bridge company ↔ profile (или внешний контакт из импорта).
- `client_legal_details_company_map` — bridge ЛК-карточка ↔ компания, для двусторонней sync.
- `company_sync_queue` — safety-net очередь для async sync (окончательное решение vs `notification_outbox` — в Phase 1 плане).

Это **закрытый список только для CRM Companies core Phase 1**. Любая дополнительная таблица, включая document/person compat tables, запрещена без отдельного duplicate discovery + approval.

**Deferred / follow-up (НЕ в Phase 1 core):**

- `company_contact_person_map` (bridge `company_contacts.id` ↔ `legal_details_persons.id`) — перенесено в **Phase 10 Documents compatibility follow-up**. Идея не удалена: в будущем для корпоративных документов связь «подписант документа ↔ company/contact» может понадобиться. Но:
  - не создаётся в Phase 1;
  - не участвует в CRM auto-backfill;
  - создаётся только после отдельного approval в Phase 10+.

**Колонки** (все **nullable**, поэтапно):
- `orders_v2.company_id` — Phase 5.
- `crm_tasks.company_id` — Phase 6.
- `calls.company_id`, `call_events.company_id` — Phase 6.
- `crm_deal_contacts` (если нет аналога — проверить в Phase 5) — Phase 5.
- `client_legal_details.company_id` — Phase 4 (после того, как RPC upsert готов).

**Services / RPC** — перечень в Phase 2.

**Edge / worker:**
- `company-sync-worker` (cron, обрабатывает `company_sync_queue`).
- `companies-import` (Phase 9, CSV/XLSX импорт).

**UI:**
- `/admin/companies` (list + карточка) — Phase 7.
- Вкладка «Компании» в `ContactDetailSheet` — Phase 8.

## 5. Что нельзя трогать (Freeze list)

1. `entitlements`, `access_grant_ledger` — schema/RLS/writer-ы.
2. `telegram_access`, `telegram_access_grants`, `telegram_access_queue`, `telegram_club_members`, `telegram_invite_links`.
3. `payments_v2` writer-flows (bepaid/stripe webhooks).
4. `profiles` — никаких switch-полей, `company_id` не добавляется.
5. `canonical-document-*` резолвер токенов — до Phase 10.
6. `has_role_v2` / `user_roles_v2` — до отдельного multi-workspace спринта.
7. `legal_details_persons`, `legal_details_entity_person_links`, `client_legal_details` с `purpose='document'` — excluded from CRM auto-source (см. §3.1). Живут своей жизнью для document-flows.
8. Закрытый список таблиц юрлиц (§4). Любая новая параллельная таблица — запрещена без отдельного discovery + approval.

## 6. Phase-by-phase implementation plan

### Phase 1 — Canonical Data Model

**Цель:** создать core-таблицы + минимальные RPC-скелеты. Без backfill, без UI, без изменений в существующих таблицах (кроме bridge-map).

**Меняется:**
- CREATE TABLE:
  - `companies`
  - `company_contacts` (с колонкой `source text NOT NULL CHECK (source IN ('billing_requisites','manual','import','call_center','admin_link','document_review'))`, колонкой `relationship_type text NOT NULL` и boolean `is_billing_contact`).
  - `client_legal_details_company_map`
  - `company_sync_queue` (или обосновать переиспользование `notification_outbox`).
- ENUM (PostgreSQL ENUM):
  - `company_kind` (legal_entity/entrepreneur/foreign/unknown)
  - `company_status` (active/archived/merged)
- **НЕ ENUM, а text CHECK / catalog:**
  - `company_contacts.source` — text CHECK (values в §3.1 п.8). Причина: список источников будет расширяться.
  - `company_contacts.relationship_type` — text CHECK или отдельный справочник (`director/owner/accountant/employee/signer/billing_contact/other`).
- Триггеры: `updated_at`, `set_public_id` (namespace `CMP`).
- RPC-скелеты: `crm_company_get_or_create`, `crm_company_link_contact` (только сигнатуры + минимальная logic).
- GRANT + RLS + audit (в `crm_activity_log` или новая audit-таблица).

**Что НЕ создаётся в Phase 1:**
- `company_contact_person_map` — deferred в Phase 10 follow-up.

**Затрагивает:** только новые объекты. Существующие таблицы — не трогает.

**Нельзя трогать:** всё из §5.

**Dependencies:** нет.

**Stop-gates перед Phase 1 execute:** Ready-checklist Discovery 0.1 = все yes ✅; отдельный документ «План: CRM Companies — Phase 1 Canonical Data Model» с полным DDL/RLS/GRANT/rollback/verification SQL одобрен.

**Dry-run:** `EXPLAIN` DDL в staging (не применяется реально), verification SQL на пустых таблицах.

**Rollback:** `DROP TABLE ... CASCADE` для 4 core-таблиц + DROP TYPE для enum-ов + DROP FUNCTION для RPC. FK на существующие таблицы отсутствуют → rollback безопасный.

**Verification SQL:**
```sql
-- structure
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue');
-- CHECK company_contacts.source
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.company_contacts'::regclass AND contype='c';
-- rls
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue');
-- grants
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue');
-- public_id generation
SELECT crm_company_get_or_create('...'); -- ожидаем CMP-000001
```

**DoD:** 4 core-таблицы + enum + RPC-скелеты + RLS + GRANT + audit + verification-SQL проходит; `supabase--linter` = 0 новых errors; `company_contact_person_map` **не создана**.

---

### Phase 2 — Backend / RPC / services

**Цель:** полноценные RPC + сервисный слой.

**Меняется:**
- RPC: `crm_company_list`, `crm_company_get`, `crm_company_create`, `crm_company_update`, `crm_company_archive`, `crm_company_merge`, `crm_company_link_contact`, `crm_company_unlink_contact`, `crm_company_set_primary_contact`, `crm_company_search`, `crm_company_upsert_from_legal_details`.
- **Source guard в `crm_company_upsert_from_legal_details(legal_details_id)`:**
  ```sql
  IF cld.purpose != 'billing' OR cld.client_type NOT IN ('legal_entity','entrepreneur') THEN
    -- log 'sync_skipped_not_billing_company', return NULL, NOT an error
    RETURN NULL;
  END IF;
  ```
- Нормализация УНП: shared `normalize_unp(text)` (уже есть — переиспользуем).
- Idempotency-ключи на create/upsert.
- Audit — `crm_activity_log`.
- Duplicate-guard: `crm_company_search_by_tax_id` возвращает существующее вместо create.

**Затрагивает:** только новые RPC. `client_legal_details` не пишется, только читается.

**Нельзя трогать:** entitlements, access, telegram, document-flows.

**Dependencies:** Phase 1.

**Stop-gate:** unit-тесты RPC (Deno-тесты для edge, pgTAP или явные SQL asserts для функций). Отдельные тесты на source guard: non-billing и individual → skip.

**Dry-run:** тесты в staging + smoke на 5 billing-карточках ЛК + 2 document-карточках (последние должны skip).

**Rollback:** `DROP FUNCTION`.

**DoD:** все RPC работают, тесты зелёные, `supabase--linter` чистый, `crm_company_upsert_from_legal_details` идемпотентна, source guard работает.

---

### Phase 3 — Backfill / dry-run / mapping

**Цель:** населить `companies` и `company_contacts` из billing-реквизитов ЛК.

**Меняется:** данные (не schema).

**Source guard (обязательно):**
```sql
-- included
WHERE cld.purpose = 'billing'
  AND cld.client_type IN ('legal_entity', 'entrepreneur')

-- excluded (лог в dry-run отчёт с reason):
--   'document_purpose_not_crm_company_source'
--   'client_type_individual_not_crm_company_source'
--   'legal_entities_requisites_no_source_legacy_id'
```

**Логика:**
1. Отобрать `client_legal_details` по source guard.
2. Нормализация всех УНП из `client_legal_details.{ent_unp,leg_unp}`.
3. Группировка по normalized УНП + country.
4. Dry-run отчёт:
   - N included / N excluded (с breakdown по reason);
   - N уникальных companies;
   - N ЛК-карточек, N ambiguous (несколько названий на 1 УНП), N без УНП.
5. Execute (отдельным approval): создание `companies` + `client_legal_details_company_map`.
6. **`company_contacts` backfill (упрощённый):** один контакт на компанию — владелец ЛК-карточки (`client_legal_details.profile_id`), со значениями:
   - `relationship_type = 'billing_contact'`
   - `is_billing_contact = true`
   - `source = 'billing_requisites'`
7. **НЕ делаем:** matcher ФИО+phone+email по `legal_details_persons`, review-очередь по persons, backfill из `legal_details_entity_person_links`. Всё это — excluded from CRM auto-source (§3.1 п.4).
8. Idempotency: повторный запуск = 0 новых дублей.

**Правило совпадения УНП (при backfill):**
1. Новую company НЕ создаём.
2. Создаём новую запись `client_legal_details_company_map` (ЛК другого клиента ↔ existing company).
3. Создаём/обновляем `company_contacts` для `client_legal_details.profile_id` этого клиента (`relationship_type='billing_contact'`, `source='billing_requisites'`).
4. Критичные поля company (`display_name`, `legal_form`, УНП) **не перезаписываются**. Расхождение → review.
5. Если existing company `status IN ('archived','merged')` → не линковать напрямую: следовать `merged_into_id`, иначе → review.

**Затрагивает:** только INSERT в новые таблицы.

**Нельзя трогать:** `client_legal_details`, `legal_details_persons`, `legal_details_entity_person_links`, `profiles`.

**Dependencies:** Phase 2.

**Stop-gate:** dry-run отчёт одобрен вручную; excluded-count разумный (≥60% строк ЛК, скорее всего, — document/individual, это нормально).

**Rollback:** `DELETE FROM companies/company_contacts WHERE created_by='backfill' AND created_at > <timestamp>`.

**Verification:**
- `SELECT COUNT(*) FROM companies WHERE tax_id_normalized IS NULL` = 0.
- `SELECT COUNT(*) FROM company_contacts WHERE source != 'billing_requisites' AND created_by='backfill'` = 0.
- Distinct normalized_unp = distinct companies.

**DoD:** backfill идемпотентен, отчёт совпадает с dry-run ±ε, `supabase--linter` чистый, никаких записей из `legal_details_persons`.

---

### Phase 4 — ЛК → Company sync

**Цель:** каждый новый/обновлённый **billing** `client_legal_details` создаёт/обновляет `companies`.

**Меняется:**
- `client_legal_details` — ALTER ADD COLUMN `company_id uuid NULL REFERENCES companies(id)`.
- В `useLegalDetails.tsx` + `LegalDetailsPickerDialog.tsx` + corporate драфт-flow: после `.insert/.update` → `supabase.rpc('crm_company_upsert_from_legal_details', {...})`. RPC сама решит skip vs upsert по source guard (Phase 2).
- Safety-net: enqueue в `company_sync_queue`, worker `company-sync-worker` (cron 1 min) — обрабатывает failed items.

**Правило конфликтов / совпадения УНП (единое с Phase 3):**
1. Новую company не создаём.
2. Создаём `client_legal_details_company_map`.
3. Создаём/обновляем `company_contacts` для profile этого клиента (`billing_contact` / `billing_requisites`).
4. Критичные поля не перезаписываются → review.
5. Если existing company `archived/merged` → следовать `merged_into_id` или review.

**Затрагивает:** `client_legal_details` (add column), 3–4 UI-файла, новая edge `company-sync-worker`.

**Нельзя трогать:** document-flows, entitlements, telegram, payments.

**Dependencies:** Phase 2, Phase 3.

**Stop-gate:** ручной smoke — новая billing-карточка ЛК → появляется company + link в map; document-карточка → sync skip без ошибки.

**Rollback:** revert UI-hook (не звать RPC), удалить колонку `client_legal_details.company_id`, отключить worker cron.

**DoD:** новые billing ЛК создают companies; document ЛК — skip; повторный save = update без дублей; failed cases видны в queue.

---

### Phase 5 — Orders / deals integration

**Цель:** привязать сделки к компаниям.

**Меняется:**
- `orders_v2` ALTER ADD COLUMN `company_id uuid NULL REFERENCES companies(id)`.
- Проверить, нет ли уже `crm_deal_contacts` (или эквивалента) — создавать только если нет.
- Backfill `orders_v2.company_id`: если `orders_v2` имеет default `client_legal_details` → взять его `company_id` через map. Иначе NULL.
- UI: `DealDetailSheet` — секция «Компания» + список доп. контактов.
- Разрешить создание сделки только с company (без contact) — для прозвона.
- Правило: paid order без access recipient → создаётся `crm_tasks` типа «уточнить получателя доступа», доступ не выдаётся автоматически.

**Затрагивает:** `orders_v2`, `DealDetailSheet`, форма создания сделки.

**Нельзя трогать:** payment webhooks, access-grant flow, `entitlements`.

**Dependencies:** Phase 4.

**Stop-gate:** все существующие сделки открываются (в т.ч. без company_id).

**Rollback:** удалить колонку `orders_v2.company_id`, revert UI.

**DoD:** сделка может быть создана с company-only; access-flow не изменился.

---

### Phase 6 — CRM tasks / calls / activity

**Цель:** задачи и звонки — по компании.

**Меняется:**
- `crm_tasks.company_id nullable` + `calls.company_id nullable` + `call_events.company_id nullable`.
- `vochi-call-initiate`: принимать `company_id`.
- `src/components/admin/calls/CallButton.tsx`: пробрасывать `companyId`.
- Лента активности компании — новый view `v_company_activity` поверх `crm_activity_log` + calls + tasks.
- `crm_activity_log` — event-типы `company.created/merged/linked/unlinked`.

**Затрагивает:** `crm_tasks`, `calls`, `call_events`, CallButton, `crm-task-notify-worker`.

**Нельзя трогать:** старые task/call payload'ы (contact/deal) — работают как раньше.

**Dependencies:** Phase 5.

**Rollback:** удалить колонки; revert UI.

**DoD:** можно создать task/call без deal, только по company; старые task/call работают.

---

### Phase 7 — UI Companies (`/admin/companies`)

**Цель:** отдельный раздел админки.

**Меняется:**
- Роут `/admin/companies`: список (фильтры: kind, status, есть контакты/нет, есть сделки/нет), поиск (name + УНП).
- Карточка компании: вкладки Профиль / Контакты / Сделки / Задачи / Звонки / Документы / Лента.
- Во вкладке **Контакты** — колонка **Source** (значения: `billing_requisites` / `manual` / `import` / `call_center` / `admin_link` / `document_review`).
- Общий `EntityDetailSheet` shell для карточек контакта и компании.
- Действия: create, edit, archive, merge, add contact, initiate call.

**Затрагивает:** только новые UI-файлы + shared shell.

**Нельзя трогать:** ContactDetailSheet legacy behavior.

**Dependencies:** Phase 2, 5, 6.

**DoD:** e2e-smoke — создание, редактирование, поиск, звонок из карточки компании; в контактах виден Source.

---

### Phase 8 — ContactDetailSheet integration

**Цель:** в карточке контакта — вкладка «Компании».

**Меняется:** ContactDetailSheet.tsx (новая вкладка), quick-link на карточку компании, роли контакта в компании.

**Нельзя трогать:** остальные вкладки контакта (Telegram/Instagram/Support/Purchases/Documents).

**Dependencies:** Phase 7.

**DoD:** контакт → вкладка Компании → переход в карточку компании работает.

---

### Phase 9 — Import / call-center база прозвона

**Цель:** массовый импорт CSV/XLSX для колл-центра.

**Меняется:**
- Edge `companies-import` (CSV/XLSX parser + mapping fields + dry-run + duplicates report).
- Bulk create tasks по импортированным компаниям, назначение ответственного.
- Flow «звонок → найден контакт по phone → создать/привязать contact».
- Импортированные `company_contacts` → `source='import'` или `'call_center'`.

**Затрагивает:** новые edge/UI, `companies`, `company_contacts`, `crm_tasks`.

**Нельзя трогать:** payment/access, document-flows.

**Dependencies:** Phase 6, 7, 8.

**DoD:** импорт 100 строк → dry-run отчёт → execute → 100 companies + 100 tasks.

---

### Phase 10 — Documents / corporate module compatibility

**Цель:** документы умеют работать через `companies`, но старый путь через `client_legal_details` не ломается.

**Меняется:**
- Резолвер токенов (`_shared/typed-tokens-resolver`, `_shared/document-data-snapshot`, `document-field-resolver-v2/sources`) — добавить `company` источник, feature-flag `documents.use_companies=false` по умолчанию.
- `ai_generated_documents` — добавить `context_type='company'` (dry-run на нескольких документах).
- Picker в UI — может показывать companies, но fallback на ЛК-карточки.

**Deferred внутри Phase 10 (отдельный approval):**
- `company_contact_person_map` (bridge `company_contacts.id` ↔ `legal_details_persons.id`) — только если по данным понадобится связь «подписант документа ↔ CRM-контакт». Создание — только через отдельный duplicate discovery + approval внутри Phase 10.
- Approved persons matcher (ФИО+phone+email → profiles) — тоже только через отдельный approval.

**Затрагивает:** document resolver, picker.

**Нельзя трогать:** compat-путь через `client_legal_details` — работает всегда.

**Dependencies:** Phase 7.

**Stop-gate:** визуальная проверка 10 сгенерированных документов = байт-в-байт совпадают со старым путём.

**DoD:** feature-flag off = 100% старое поведение; feature-flag on = documents можно рендерить из company.

---

### Phase 11 — System health / invariants / final regression

**Цель:** invariant-чеки + очистка compat-layer (частично).

**Проверки:**
- Нет `entitlements` с company (invariant).
- `company_contacts` валидны (нет sirot без company_id).
- Нет дублей companies по normalized_unp.
- **Нет company_contacts с `source='billing_requisites'`, у которых source_legal_details.purpose != 'billing'** (invariant source guard).
- **Нет companies, у которых источник — только document-purpose `client_legal_details`** (invariant).
- Legal orders (`ent_unp`/`leg_unp` в ЛК) имеют `company_id` или явный review reason.
- Старые contact-only сделки продолжают работать.
- Старые документы открываются.
- Старые оплаты работают.
- ЛК сохраняет реквизиты как раньше.

**Затрагивает:** `nightly-system-health`, новые чек-функции.

**DoD:** все invariant-чеки зелёные 7 дней подряд; можно планировать multi-workspace миграцию.

## 7. Dependencies между фазами

```text
Phase 1 (schema)
  └─ Phase 2 (RPC + source guard)
       └─ Phase 3 (backfill: billing-only)
            └─ Phase 4 (ЛК sync: billing-only, guard в RPC)
                 └─ Phase 5 (orders)
                      └─ Phase 6 (tasks/calls)
                           ├─ Phase 7 (UI companies + Source column)
                           │    └─ Phase 8 (contact ↔ company UI)
                           │         └─ Phase 9 (import)
                           └─ (parallel) Phase 10 (documents + deferred person_map)
                                └─ Phase 11 (final regression + source invariants)
```

## 8. Stop-gates (перед каждой фазой)

- Отдельный документ `План: CRM Companies — Phase N` создан и одобрен.
- Ready-checklist предыдущей фазы = все yes.
- `supabase--linter` чистый.
- Rollback-скрипт написан и проверен на staging (где возможно).

## 9. Rollback strategy

- **Phase 1–2:** DROP TABLE / DROP FUNCTION — данных нет.
- **Phase 3:** `DELETE ... WHERE source='billing_requisites' AND created_by='backfill'`.
- **Phase 4+:** revert UI-хуков + ALTER TABLE DROP COLUMN; feature-flag off.
- **Phase 10:** feature-flag `documents.use_companies=false` — мгновенный откат.

Compat-layer через `client_legal_details` сохраняется во всех фазах — гарантия, что откат любой фазы не ломает документы/ЛК.

## 10. Verification matrix (сводно)

| Фаза | Verification |
|---|---|
| 1 | Schema/RLS/GRANT SQL-чеки; `company_contact_person_map` НЕ существует |
| 2 | Unit-тесты RPC + source guard тесты (billing→upsert, document→skip, individual→skip) |
| 3 | Идемпотентность backfill, distinct-count, excluded-by-reason отчёт |
| 4 | Smoke: billing ЛК → company; document ЛК → skip; UNP-collision → map+contact без overwrite |
| 5 | Все существующие сделки открываются |
| 6 | Task/call без deal возможен, старые работают |
| 7 | e2e /admin/companies + колонка Source в контактах |
| 8 | ContactDetailSheet → Companies tab |
| 9 | Import 100 rows dry-run + execute |
| 10 | 10 документов байт-в-байт совпадают со старым путём |
| 11 | Все invariant-чеки в `nightly-system-health`, включая source guard invariants |

## 11. Open questions / deferred items

1. **Safety-net queue:** `company_sync_queue` vs `notification_outbox` — окончательное решение в Phase 1 плане.
2. **Trigger → pg_net → RPC:** отложено. Отдельный technical spike (DevEx риск, наблюдаемость, retries). До завершения spike — не используем.
3. **Multi-workspace:** сейчас single (system tenant). Multi-workspace миграция всех CRM-таблиц — отдельный спринт после Phase 11.
4. **`legal_entities_requisites` vs `client_legal_details`:** долгосрочно нужно консолидировать. В скоуп текущего Master Plan НЕ входит — обе остаются compat SOT; LER — только secondary mirror.
5. **`company_contact_person_map` + persons matcher (ФИО+phone+email → profiles):** deferred в Phase 10. Только через отдельный approval. Из Phase 3 удалено полностью.
6. **`crm_deal_contacts`:** проверить, нет ли эквивалента, прежде чем создавать. Финальное решение в Phase 5 плане.
7. **Documents feature-flag rollout:** какие продукты первыми переходят на company-based резолвер — Phase 10 план.
8. **Public_id namespace:** согласовано `CMP-000001` (не `C-XXXXXX`, чтобы не путать с Contact).
9. **`relationship_type` catalog:** text CHECK или отдельная catalog-таблица — решается в Phase 1 плане (влияет на i18n лейблов).
