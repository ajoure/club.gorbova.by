# CRM Companies — Master Implementation Plan

Дата: 2026-07-07. Документ описывает **весь путь внедрения canonical-сущности `companies`** по фазам. Каждая фаза запускается отдельным approval — этот документ **не является runnable планом Phase 1**.

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

Стратегия: **add-only**. Никаких breaking-изменений в `profiles`, `entitlements`, `telegram_*`, `payments_v2`, `orders_v2` writer-flows. Compat-layer через `client_legal_details` сохраняется минимум до Phase 10.

## 2. Итоговая архитектура

```text
                  ┌──────────────┐          ┌────────────────────┐
                  │   companies  │◄─────────┤ client_legal_details│  (compat SOT)
                  └──────┬───────┘  1:N via │  + legal_entities_  │
                         │           map    │   requisites        │
                         │                   └────────────────────┘
              1:N (company_contacts)
                         │
                         ▼
                  ┌──────────────┐          ┌──────────┐
                  │   profiles   │◄─────────┤ contacts │  (profiles = физлица)
                  └──────────────┘          └──────────┘
                         │
                         │ (entitlements/telegram/access — ТОЛЬКО здесь)
                         ▼
                  ┌──────────────┐
                  │ entitlements │
                  └──────────────┘

orders_v2.company_id (nullable) ──► companies
crm_tasks.company_id (nullable)  ──► companies
calls.company_id (nullable)      ──► companies
ai_generated_documents.context_type='company' (Phase 10)
```

## 3. Что остаётся legacy / compat-layer

- `client_legal_details` — SOT реквизитов ЛК до Phase 10; читается всеми document-flows.
- `legal_entities_requisites` — view-layer поверх ЛК (`source_legacy_id`); shadow-резолвер `document-field-resolver-v2`.
- `legal_details_persons` + `legal_details_entity_person_links` — источник для backfill `company_contacts`, остаются активны для документов.
- `generated_documents` (legacy) — deprecated в UI, только audit.

## 4. Что создаётся новое

Таблицы:
- `companies` (canonical компания/ИП/юрлицо, `public_id` формата `CMP-000001`).
- `company_contacts` (bridge company ↔ profiles или внешний person).
- `client_legal_details_company_map` (bridge ЛК-карточка ↔ компания, для двусторонней sync).
- `company_contact_person_map` (bridge `company_contacts.id` ↔ `legal_details_persons.id`).
- `company_sync_queue` ИЛИ переиспользование `notification_outbox` — решается в Phase 1.

Колонки (все **nullable**, поэтапно):
- `orders_v2.company_id` — Phase 5.
- `crm_tasks.company_id` — Phase 6.
- `calls.company_id`, `call_events.company_id` — Phase 6.
- `crm_deal_contacts` (если нет аналога) — Phase 5.
- `client_legal_details.company_id` — Phase 4 (после того, как RPC upsert готов).

Services / RPC — перечень в §6.2.

Edge / worker:
- `company-sync-worker` (cron, обрабатывает `company_sync_queue`).
- `companies-import` (Phase 9, CSV/XLSX импорт).

UI:
- `/admin/companies` (list + карточка) — Phase 7.
- Вкладка «Компании» в `ContactDetailSheet` — Phase 8.

## 5. Что нельзя трогать (Freeze list)

1. `entitlements`, `access_grant_ledger` — schema/RLS/writer-ы.
2. `telegram_access`, `telegram_access_grants`, `telegram_access_queue`, `telegram_club_members`, `telegram_invite_links`.
3. `payments_v2` writer-flows (bepaid/stripe webhooks).
4. `profiles` — никаких switch-полей, `company_id` не добавляется.
5. `canonical-document-*` резолвер токенов — до Phase 10.
6. `has_role_v2`/`user_roles_v2` — до отдельного multi-workspace спринта.

## 6. Phase-by-phase implementation plan

### Phase 1 — Canonical Data Model

**Цель:** создать таблицы + минимальные RPC-скелеты. Без backfill, без UI, без изменений в существующих таблицах (кроме bridge-map).

**Меняется:**
- CREATE TABLE `companies`, `company_contacts`, `client_legal_details_company_map`, `company_contact_person_map`.
- ENUM: `company_kind` (legal_entity/entrepreneur/foreign/unknown), `company_status` (active/archived/merged), `company_contact_role` (director/owner/accountant/employee/signer/other), `company_source`.
- CREATE `company_sync_queue` (или обосновать переиспользование `notification_outbox`).
- Триггеры: `updated_at`, `set_public_id` (namespace `CMP`).
- RPC-скелеты: `crm_company_get_or_create`, `crm_company_link_contact` (только сигнатуры + минимальная logic, безопасны для вызова).
- GRANT + RLS + audit-таблица (или использование `crm_activity_log`).

**Затрагивает:** только новые объекты. Существующие таблицы — не трогает.

**Нельзя трогать:** всё из §5.

**Dependencies:** нет.

**Stop-gates перед Phase 1 execute:** Ready-checklist Discovery 0.1 = все yes ✅; отдельный документ «План: CRM Companies — Phase 1 Canonical Data Model» с полным DDL/RLS/GRANT/rollback/verification SQL одобрен.

**Dry-run:** `EXPLAIN` DDL в staging (не применяется реально), verification SQL на пустых таблицах.

**Rollback:** `DROP TABLE ... CASCADE` для 4 новых таблиц + DROP TYPE для enum-ов + DROP FUNCTION для RPC. Т.к. FK на существующие таблицы отсутствуют (кроме bridge-map, который тоже дропаем), rollback безопасный.

**Verification SQL:**
```sql
-- structure
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('companies','company_contacts','client_legal_details_company_map','company_contact_person_map');
-- rls
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'companies%' OR tablename LIKE 'company_%';
-- grants
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name IN (...);
-- public_id generation
SELECT crm_company_get_or_create('...'); -- ожидаем CMP-000001
```

**DoD:** 4 таблицы + enum + RPC-скелеты + RLS + GRANT + audit + verification-SQL проходит; `supabase--linter` = 0 новых errors.

---

### Phase 2 — Backend / RPC / services

**Цель:** полноценные RPC + сервисный слой, готовые к использованию из ЛК/UI.

**Меняется:**
- RPC: `crm_company_list`, `crm_company_get`, `crm_company_create`, `crm_company_update`, `crm_company_archive`, `crm_company_merge`, `crm_company_link_contact`, `crm_company_unlink_contact`, `crm_company_set_primary_contact`, `crm_company_search`, `crm_company_upsert_from_legal_details`.
- Нормализация УНП: shared function `normalize_unp(text)` (уже есть — переиспользуем).
- Idempotency-ключи на create/upsert.
- Audit — в `crm_activity_log` или новую audit-таблицу.
- Duplicate-guard: `crm_company_search_by_tax_id` возвращает существующее вместо create.

**Затрагивает:** только новые RPC. `client_legal_details` не пишется, только читается.

**Нельзя трогать:** entitlements, access, telegram.

**Dependencies:** Phase 1.

**Stop-gate:** unit-тесты RPC (Deno-тесты для edge, pgTAP или явные SQL asserts для функций).

**Dry-run:** тесты в staging + smoke на 5 карточках ЛК.

**Rollback:** `DROP FUNCTION`.

**DoD:** все RPC работают, тесты зелёные, `supabase--linter` чистый, `crm_company_upsert_from_legal_details` идемпотентна.

---

### Phase 3 — Backfill / dry-run / mapping

**Цель:** населить `companies` и `company_contacts` из существующих `client_legal_details` + `legal_details_persons`.

**Меняется:** данные (не schema).

**Логика:**
1. Нормализация всех УНП из `client_legal_details.{ent_unp,leg_unp}`.
2. Группировка по normalized УНП + country.
3. Dry-run отчёт: N уникальных компаний, N ЛК-карточек, N ambiguous (несколько названий на 1 УНП), N без УНП.
4. Execute (отдельным approval): создание `companies` + `client_legal_details_company_map`.
5. `company_contacts` — из `legal_details_entity_person_links` (`legal_details_id → company_id` через map, `person_id → company_contacts.person_ref`).
6. `company_contacts.profile_id` — **matcher-ом** по ФИО+phone+email против `profiles`. Low-confidence → в review-очередь. **Никогда не берётся напрямую из `LDP.profile_id`.**
7. Idempotency: повторный запуск = 0 новых дублей.

**Затрагивает:** только INSERT в новые таблицы.

**Нельзя трогать:** `client_legal_details`, `legal_details_persons`, `profiles`.

**Dependencies:** Phase 2.

**Stop-gate:** dry-run отчёт одобрен вручную.

**Rollback:** `DELETE FROM companies/company_contacts WHERE created_by='backfill' AND created_at > <timestamp>`.

**Verification:** сравнение distinct normalized_unp до/после; `SELECT COUNT(*) FROM companies WHERE tax_id_normalized IS NULL`.

**DoD:** backfill идемпотентен, отчёт совпадает с dry-run ±ε, `supabase--linter` чистый.

---

### Phase 4 — ЛК → Company sync

**Цель:** каждый новый/обновлённый `client_legal_details` создаёт/обновляет `companies`.

**Меняется:**
- `client_legal_details` — ALTER ADD COLUMN `company_id uuid NULL REFERENCES companies(id)`.
- В `useLegalDetails.tsx` + `LegalDetailsPickerDialog.tsx` + corporate драфт-flow: после `.insert/.update` → `supabase.rpc('crm_company_upsert_from_legal_details', {...})`.
- Safety-net: enqueue в `company_sync_queue`, worker `company-sync-worker` (cron 1 min) — обрабатывает failed items.
- Правило конфликтов: если existing `companies` найдена по УНП, но `display_name` расходится — не перезаписываем, создаём review-запись.

**Затрагивает:** `client_legal_details` (add column), 3–4 UI-файла, новую edge `company-sync-worker`.

**Нельзя трогать:** document-flows, entitlements, telegram, payments.

**Dependencies:** Phase 2, Phase 3.

**Stop-gate:** ручной smoke — новая карточка ЛК → появляется company + link в map.

**Rollback:** revert UI-hook (не звать RPC), удалить колонку `client_legal_details.company_id`, отключить worker cron.

**DoD:** новые ЛК создают companies; повторный save = update без дублей; failed cases видны в queue.

---

### Phase 5 — Orders / deals integration

**Цель:** привязать сделки к компаниям.

**Меняется:**
- `orders_v2` ALTER ADD COLUMN `company_id uuid NULL REFERENCES companies(id)`.
- (если нет) CREATE TABLE `crm_deal_contacts` (deal_id, contact_profile_id, role).
- Backfill `orders_v2.company_id`: если `orders_v2.profile_id` имеет default `client_legal_details` → взять его `company_id` через map. Иначе NULL.
- UI: `DealDetailSheet` — секция «Компания» + список доп. контактов (кроме основного).
- Разрешить создание сделки только с company (без contact) — для прозвона.
- Правило: paid order без access recipient → создаётся `crm_tasks` типа «уточнить получателя доступа», доступ не выдаётся автоматически.

**Затрагивает:** `orders_v2`, `DealDetailSheet`, форма создания сделки.

**Нельзя трогать:** payment webhooks, access-grant flow, `entitlements`.

**Dependencies:** Phase 4.

**Stop-gate:** проверка, что все существующие сделки продолжают открываться (в т.ч. без company_id).

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
- `crm_activity_log` — добавить новые event-типы `company.created/merged/linked/unlinked`.

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
- Общий `EntityDetailSheet` shell для карточек контакта и компании (без copy-paste).
- Действия: create, edit, archive, merge, add contact, initiate call.

**Затрагивает:** только новые UI-файлы + shared shell.

**Нельзя трогать:** ContactDetailSheet legacy behavior.

**Dependencies:** Phase 2, 5, 6.

**DoD:** e2e-smoke — создание, редактирование, поиск, звонок из карточки компании.

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

**Затрагивает:** новые edge/UI, `companies`, `company_contacts`, `crm_tasks`.

**Нельзя трогать:** payment/access.

**Dependencies:** Phase 6, 7, 8.

**DoD:** импорт 100 строк → dry-run отчёт → execute → 100 companies + 100 tasks.

---

### Phase 10 — Documents / corporate module compatibility

**Цель:** документы умеют работать через `companies`, но старый путь через `client_legal_details` не ломается.

**Меняется:**
- Резолвер токенов (`_shared/typed-tokens-resolver`, `_shared/document-data-snapshot`, `document-field-resolver-v2/sources`) — добавить `company` источник, feature-flag `documents.use_companies=false` по умолчанию.
- `ai_generated_documents` — добавить `context_type='company'` (dry-run на нескольких документах).
- Picker в UI — может показывать companies, но fallback на ЛК-карточки.
- Миграция document module — вынесена в отдельный follow-up.

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
- `company_contacts` валидны (нет sirotа без company_id).
- Нет дублей companies по normalized_unp.
- Legal orders (`ent_unp`/`leg_unp` в ЛК) имеют `company_id` или явный review reason.
- Старые contact-only сделки продолжают работать.
- Старые документы открываются.
- Старые оплаты работают.
- ЛК сохраняет реквизиты как раньше.

**Затрагивает:** `nightly-system-health`, новые чек-функции.

**DoD:** все invariant-чеки зелёные 7 дней подряд; можно планировать multi-workspace миграцию как следующий большой блок.

## 7. Dependencies между фазами

```text
Phase 1 (schema)
  └─ Phase 2 (RPC)
       └─ Phase 3 (backfill)
            └─ Phase 4 (ЛК sync)
                 └─ Phase 5 (orders)
                      └─ Phase 6 (tasks/calls)
                           ├─ Phase 7 (UI companies)
                           │    └─ Phase 8 (contact ↔ company UI)
                           │         └─ Phase 9 (import)
                           └─ (parallel) Phase 10 (documents)
                                └─ Phase 11 (final regression)
```

## 8. Stop-gates (перед каждой фазой)

- Отдельный документ `План: CRM Companies — Phase N` создан и одобрен.
- Ready-checklist предыдущей фазы = все yes.
- `supabase--linter` чистый.
- Rollback-скрипт написан и проверен на staging (где возможно).

## 9. Rollback strategy

- **Phase 1–2:** DROP TABLE / DROP FUNCTION — данных нет.
- **Phase 3:** `DELETE ... WHERE source='backfill'`.
- **Phase 4+:** revert UI-хуков + ALTER TABLE DROP COLUMN; feature-flag off.
- **Phase 10:** feature-flag `documents.use_companies=false` — мгновенный откат.

Compat-layer через `client_legal_details` сохраняется во всех фазах — это гарантия, что откат любой фазы не ломает документы/ЛК.

## 10. Verification matrix (сводно)

| Фаза | Verification |
|---|---|
| 1 | Schema/RLS/GRANT SQL-чеки |
| 2 | Unit-тесты RPC |
| 3 | Идемпотентность backfill, distinct-count |
| 4 | Smoke: новая ЛК-карточка → company |
| 5 | Все существующие сделки открываются |
| 6 | Task/call без deal возможен, старые работают |
| 7 | e2e /admin/companies |
| 8 | ContactDetailSheet → Companies tab |
| 9 | Import 100 rows dry-run + execute |
| 10 | 10 документов байт-в-байт совпадают со старым путём |
| 11 | Все invariant-чеки в `nightly-system-health` |

## 11. Open questions / deferred items

1. **Safety-net queue:** `company_sync_queue` vs переиспользование `notification_outbox` — окончательное решение в Phase 1 плане.
2. **Trigger → pg_net → RPC:** отложено. Требует отдельного technical spike (DevEx риск, наблюдаемость, retries). До завершения spike — не используем.
3. **Multi-workspace:** сейчас single (system tenant). Multi-workspace миграция всех CRM-таблиц (`crm_pipelines`, `orders_v2`, `profiles`, `companies`) — отдельный спринт после Phase 11.
4. **`legal_entities_requisites` vs `client_legal_details`:** долгосрочно нужно консолидировать. В скоуп текущего Master Plan НЕ входит — обе таблицы остаются compat SOT.
5. **`legal_details_persons.profile_id` matcher:** алгоритм matching (ФИО+phone+email → profiles) с confidence-score — детализировать в Phase 3 плане.
6. **`crm_deal_contacts`:** проверить, нет ли уже эквивалентной таблицы, прежде чем создавать. Финальное решение в Phase 5 плане.
7. **Documents feature-flag rollout:** какие продукты первыми переходят на company-based резолвер — согласовать в Phase 10 плане.
8. **Public_id namespace:** согласовано `CMP-000001` (не `C-XXXXXX`, чтобы не путать с Contact).
