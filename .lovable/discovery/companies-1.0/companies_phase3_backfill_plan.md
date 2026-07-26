# План: CRM Companies — Phase 3B Backfill Plan + Rollback-only Rehearsal

**Версия:** 1.2
**Статус:** Phase 3B = подготовка runnable-плана **и** rollback-only rehearsal.
**Phase 3C:** запрещён без отдельного явного admin approval.
**Основано на:** `companies_phase3_backfill_discovery.md` v1.2 (Phase 3A PASS).

---

## 1. Required scope

Однократный backfill из `public.client_legal_details` в canonical слой CRM Companies 1.0.

**В scope:**
- Создание записей в `public.companies` (16 unique UNP).
- Создание записей в `public.client_legal_details_company_map` (17).
- Создание записей в `public.company_contacts` с `relationship_type='billing_contact'` и `is_billing_contact=true` (17).
- Фиксация факта инференса `country='BY'` в execution ledger/report (в canonical метаданных `country_source` не пишется, если в Phase 3B не одобрен отдельный writer).

**Вне scope:**
- Любые изменения схемы (DDL).
- Новые RPC/функции/триггеры/enum (кроме случая явно одобренного internal service writer, см. §4).
- Изменения UI, types, зависимостей.
- Backfill сущностей вне CRM Companies.
- Любые действия на production до отдельного approval Phase 3C.

---

## 2. Source of truth

- **Источник:** `public.client_legal_details` (48 строк, 17 eligible).
- **Eligibility:** валидный UNP (9 цифр), не пустой профиль-владелец.
- **Правила резолюции:**
  - `unp` — ключ дедупликации в `public.companies`.
  - `kind` ∈ {`legal_entity`, `entrepreneur`} → `company_kind`.
  - `country` — отсутствует в источнике; жёстко `'BY'` внутри `crm_company_upsert_from_billing`.
  - Профиль CLD → `public.company_contacts` с `relationship_type='billing_contact'`, `is_billing_contact=true`, `profile_id` из источника.
  - `country_source='inferred_by_domain'` — **не** postcondition текущего RPC; фиксируется только в execution ledger/report.

---

## 3. Permission / service-role model

- Все write-операции проходят через один согласованный контракт оркестрации (см. §4). Прямые ad-hoc записи в canonical таблицы запрещены; map INSERT — единственное контролируемое исключение из отсутствующего map RPC (см. §4 и §5).
- ACL Phase 1 (REVOKE у `anon/PUBLIC` на `companies`, `client_legal_details_company_map`, `company_contacts`) не изменяется.
- Для варианта (a) используется **выделенная admin test identity** — исключительно как identity для вызова `crm_company_link_contact`. Это не бизнес-источник данных; её записи/профиль не модифицируются и не переиспользуются.

---

## 4. Execution-identity gate (обязателен до rehearsal)

Существующие Phase 2 RPC имеют разные identity-требования, поэтому один service-role вызов **не** покрывает все три действия. **Возможность объединить разные identity (service_role + authenticated admin) в одну транзакцию — предмет доказательства в identity rehearsal и не может утверждаться заранее.**

| Действие | Механизм | Identity |
|---|---|---|
| `public.companies` upsert | `crm_company_upsert_from_billing` | `service_role` |
| `public.client_legal_details_company_map` insert | RPC отсутствует | controlled, run-tagged SQL под управляемой транзакцией **или** отдельный internal writer |
| `public.company_contacts` insert (billing) | `crm_company_link_contact` | `authenticated` + role guard `admin` / `super_admin` / `menedzher` |

**До rehearsal Phase 3B обязан выбрать и доказать один способ оркестрации в rollback-only режиме:**

- **Вариант (a) — controlled, run-tagged SQL под управляемой транзакцией:**
  - `crm_company_upsert_from_billing` вызывается под `service_role`.
  - `crm_company_link_contact` вызывается под admin JWT выделенной admin test identity, с проверкой role guard.
  - Вставка в `client_legal_details_company_map` — **единственное контролируемое исключение** из отсутствующего map RPC: только через идемпотентный map writer (см. §5), с обязательным run-tag, записью в execution ledger и точными cleanup IDs.
  - Транзакционная модель (границы транзакции, возможность объединения identity, точки COMMIT/ROLLBACK) — доказывается в identity rehearsal; не постулируется.
- **Вариант (b) — новый узкий internal service writer:**
  - Покрывает все три действия одним контрактом.
  - Создаётся **только после отдельного approval** (в текущем Phase 3B по умолчанию не создаётся).

Выбранный вариант и результаты доказательства фиксируются в отчёте rehearsal.

---

## 5. Idempotency

- `crm_company_upsert_from_billing` — идемпотентен по UNP (дедупликация в `public.companies`).
- `crm_company_link_contact` — идемпотентен по `(company_id, profile_id, relationship_type)` в `public.company_contacts`.
- `public.client_legal_details_company_map` — единственный `UNIQUE` на `client_legal_details_id`. **Идемпотентный map writer:**
  1. `SELECT company_id FROM public.client_legal_details_company_map WHERE client_legal_details_id = :cld_id`.
  2. Если запись найдена и `company_id` совпадает с ожидаемым — `noop`.
  3. Если запись найдена и `company_id` не совпадает — **немедленный abort** rehearsal/backfill как conflict; фиксация в ledger.
  4. Если записи нет — `INSERT` с фиксацией id в ledger.
- **Проверка:** повторный проход в rehearsal обязан вернуть `inserted=0`, `updated=0`, `noop=17` по всем трём таблицам.

---

## 6. Concurrency

- Backfill — однопоточно, границы транзакции определяются выбранным вариантом §4 и подтверждаются identity rehearsal.
- Advisory locks внутри Phase 2 RPC (concurrency proof PASS) защищают от гонок с runtime-траффиком.
- На время исполнения запрещены параллельные административные скрипты, затрагивающие `companies`, `client_legal_details_company_map`, `company_contacts`.

---

## 7. Rollback

- **Обязательный rollback-артефакт** формируется до Phase 3C и сохраняется вне каталога миграций.
- Rollback точечно удаляет ровно те id, которые созданы backfill-ом в `company_contacts`, `client_legal_details_company_map`, `companies` (в обратном порядке зависимостей), используя execution ledger с exact cleanup IDs. Никаких `TRUNCATE`; никакого воздействия на пользовательские данные вне scope.
- Восстановление sequences: **только** `public_id_sequences.company` до baseline `0` — и только если guard подтверждает, что `public.companies` пустая после cleanup. Для `public.client_legal_details_company_map` собственной sequence нет и восстанавливать нечего.
- Rollback проходит обязательный **rollback-only rehearsal** до Phase 3C.

---

## 8. Verification

**Pre-flight (read-only):**
- Baseline canonical пуст: `companies=0`, `client_legal_details_company_map=0`, `company_contacts` (billing) = 0.
- `public_id_sequences.company = 0`; map sequence не проверяется (отсутствует).
- CLD inventory совпадает с discovery (48/17, 7/10 по kind).
- ACL Phase 1 в силе; линтер чист.

**Post-run:**
- `public.companies count = 16`; все с `country='BY'`.
- `public.client_legal_details_company_map count = 17`; покрывают все eligible CLD; `UNIQUE(client_legal_details_id)` не нарушен.
- `public.company_contacts` с `relationship_type='billing_contact'` и `is_billing_contact=true` count = 17.
- UNP `193405000` → 1 company, 2 billing contact.
- Профиль с двумя UNP → 2 company через 2 map (штатный сценарий).
- Повторный прогон backfill не меняет счётчиков (идемпотентность).
- Факт инференса `country='BY'` зафиксирован в execution ledger/report.
- Линтер (`supabase--linter`) — чист.

---

## 9. Fixtures cleanup

- Все вставки rehearsal выполняются в rollback-only режиме; данные в БД не остаются.
- Временные run-tag'и удаляются в том же цикле и проверяются post-check-ом; execution ledger сохраняет exact cleanup IDs.
- **Выделенная admin test identity** не изменяется, не удаляется, не переиспользуется как источник данных.

---

## 10. Stop-guards

Rehearsal и (после approval) Phase 3C немедленно останавливаются и откатываются, если:

1. Baseline canonical не пуст.
2. CLD inventory отличается от зафиксированного в discovery (eligible ≠ 17, unique UNP ≠ 16).
3. Появился новый hard blocker (например, третий профиль на UNP `193405000` или невалидный UNP среди eligible).
4. ACL-контракт Phase 1 нарушен (появились grants у `anon/PUBLIC`).
5. Линтер выдаёт новые ошибки/warnings.
6. Не выбран или не доказан execution-identity вариант (§4), включая транзакционные границы.
7. Map writer обнаружил существующую запись с несовпадающим `company_id` (см. §5) — немедленный abort как conflict.
8. Повторный проход backfill в rehearsal создаёт новые строки (нарушение идемпотентности).
9. Rollback-only rehearsal не прошёл PASS.
10. Отсутствует явный admin approval на Phase 3C.

---

## 11. DoD Phase 3B

- [x] Scope зафиксирован (in/out) на реальных именах таблиц.
- [x] Source of truth и eligibility описаны.
- [x] Permission model и execution-identity gate явно зафиксированы, включая ограничение по объединению identity.
- [x] Идемпотентный map writer определён (read-then-insert с conflict abort).
- [x] Идемпотентность, concurrency, rollback описаны; учтено отсутствие sequence у map.
- [x] Верификация pre/post зафиксирована.
- [x] Fixtures cleanup описан; используется выделенная admin test identity.
- [x] Stop-guards перечислены (10 пунктов).
- [x] Rollback-only rehearsal — обязательная часть Phase 3B.
- [x] Явный запрет Phase 3C без отдельного admin approval.

---

## 12. Порядок последующих шагов

1. Approve этого плана.
2. Выбор и доказательство execution-identity варианта (§4) в rollback-only режиме, включая транзакционные границы.
3. Rollback-only rehearsal backfill — обязательный PASS.
4. Отдельный admin approval на Phase 3C.
5. Phase 3C execution (однократно, строго по плану) + verification.

**До получения approval на Phase 3C никаких действий с реальными данными не производится.**
