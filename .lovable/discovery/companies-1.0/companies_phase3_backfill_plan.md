# План: CRM Companies — Phase 3B Backfill Plan (PLAN ONLY)

**Версия:** 1.0
**Статус:** PLAN ONLY / DO NOT EXECUTE
**Основано на:** `companies_phase3_backfill_discovery.md` (Phase 3A PASS).
**Запуск Phase 3C:** запрещён без отдельного явного admin approval.

---

## 1. Required scope

Однократный backfill данных из `public.client_legal_details` в canonical слой CRM Companies 1.0.

**В scope:**
- Создание canonical `companies` (16 unique UNP).
- Создание `maps` (17 записей CLD → company).
- Создание `contacts` роли `billing_contact` (17 записей).
- Установка `country = 'BY'` через resolver `inferred_by_domain`.

**Вне scope:**
- Любые изменения схемы (DDL).
- Новые RPC/функции/триггеры/enum.
- Изменения UI, types, зависимостей.
- Backfill сущностей вне CRM Companies (deals, orders, invoices и т.п.).
- Изменения production до отдельного approval.

---

## 2. Source of truth

- **Источник:** `public.client_legal_details` (48 строк, из них 17 eligible).
- **Фильтр eligibility:** валидный UNP (9 цифр), не пустой профиль-владелец.
- **Правила резолюции:**
  - `unp` → канонический ключ дедупликации.
  - `kind` ∈ {`legal_entity`, `entrepreneur`} → маппинг в `company_kind`.
  - `country` отсутствует → `BY` (`inferred_by_domain`).
  - Профиль CLD → `billing_contact` с `profile_id` из источника.

---

## 3. Permission / service-role model

- Выполнение backfill — только через `service_role` в рамках миграции Lovable Cloud (`supabase--migration`) либо через SECURITY DEFINER RPC из Phase 2.
- `anon` и `authenticated` — доступа к операции нет.
- Все canonical write-операции проходят через Phase 2 контракт (`crm_company_get_or_create`, `crm_company_link_contact`, billing upsert), никаких прямых `INSERT` в canonical таблицы.
- ACL-контракт Phase 1 (REVOKE у `anon/PUBLIC`) не изменяется.

---

## 4. Idempotency

- Основа: `crm_company_get_or_create` дедуплицирует по `(country, unp)` и возвращает существующий `company_id` без побочных side-effects при повторном вызове.
- `crm_company_link_contact` идемпотентен по `(company_id, profile_id, role)`.
- Billing upsert использует `array_append` (пост-фикс Phase 2) — повторный прогон не создаёт дублей значений.
- Повторный запуск полного backfill не должен создавать новых строк и не должен генерировать дополнительных доменных событий/логов.

**Проверка идемпотентности:** второй проход в rehearsal обязан вернуть `inserted=0`, `updated=0`, `noop=17`.

---

## 5. Concurrency

- Backfill выполняется в одной транзакции, однопоточно.
- Внутри `crm_company_get_or_create` уже используются advisory locks (Phase 2, concurrency proof PASS) — параллельный runtime-траффик не приведёт к дублированию.
- На время исполнения запрещено параллельно запускать любые административные скрипты, затрагивающие `companies/maps/contacts`.

---

## 6. Rollback

- **Обязательный rollback-артефакт** формируется до Phase 3C и сохраняется вне каталога миграций.
- Rollback описывает удаление ровно тех canonical id, которые созданы backfill-ом (никаких `TRUNCATE`, никакого воздействия на пользовательские данные вне scope).
- Восстановление sequences (`companies`, `maps`) до baseline значений (0/0), зафиксированных в discovery.
- Rollback тестируется в rollback-only rehearsal перед Phase 3C.

---

## 7. Verification

**Pre-flight (read-only):**
- Baseline canonical пуст (`companies=0`, `maps=0`, `contacts.role=billing_contact=0`).
- Sequences = 0.
- CLD inventory совпадает с discovery (48/17, 7/10 по kind).

**Post-run:**
- `companies count = 16`, все с `country='BY'`, `country_source='inferred_by_domain'`.
- `maps count = 17`, покрывают все eligible CLD.
- `contacts` роли `billing_contact` count = 17.
- UNP `193405000` → 1 company, 2 billing contact.
- Профиль с двумя CLD → 2 company через 2 map.
- Повторный прогон backfill не изменяет счётчиков (идемпотентность).
- Линтер (`supabase--linter`) — чист, без новых warnings.

---

## 8. Fixtures cleanup

- Тестовые вставки rehearsal-а выполняются в транзакции с `ROLLBACK`; никаких данных в БД не остаётся.
- Если для rehearsal создаются временные run-tag'и — они удаляются в том же блоке и явно проверяются post-check-ом.
- Admin fixture `1@ajoure.by` (роль `admin`) — не изменяется, не удаляется, не переиспользуется как источник данных.

---

## 9. Stop-guards

Выполнение Phase 3C немедленно останавливается и откатывается, если:

1. Baseline canonical не пуст (появились строки между discovery и execution).
2. CLD inventory отличается от зафиксированного в discovery (кол-во eligible ≠ 17, unique UNP ≠ 16).
3. Обнаружен новый hard blocker (например, третий профиль на UNP `193405000` или невалидный UNP среди eligible).
4. ACL-контракт Phase 1 нарушен (появились grants у `anon/PUBLIC`).
5. Линтер выдаёт новые ошибки/warnings.
6. Rollback-only rehearsal не прошёл PASS.
7. Второй проход backfill в rehearsal создаёт новые строки (нарушение идемпотентности).
8. Отсутствует явный admin approval на Phase 3C.

---

## 10. DoD плана

- [x] Scope зафиксирован (in/out).
- [x] Source of truth и eligibility правила описаны.
- [x] Permission model — только service_role / SECURITY DEFINER RPC.
- [x] Идемпотентность, concurrency, rollback описаны.
- [x] Верификация pre/post зафиксирована.
- [x] Fixtures cleanup описан.
- [x] Stop-guards перечислены (8 пунктов).
- [x] Явно указан запрет на Phase 3C без approval и обязательный rollback-only rehearsal перед ним.

---

## 11. Порядок последующих шагов

1. Approve плана (этот документ).
2. Подготовка rollback-only rehearsal (отдельный артефакт, без исполнения на реальных данных).
3. Rollback-only rehearsal — обязательный PASS.
4. Отдельный admin approval на Phase 3C.
5. Phase 3C execution (однократно, строго по плану) + verification.

**До получения approval на Phase 3C никаких действий с данными не производится.**
