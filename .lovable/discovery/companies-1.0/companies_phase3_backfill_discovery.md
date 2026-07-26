# CRM Companies — Phase 3A Backfill Discovery Report

**Версия:** 1.2
**Статус:** DISCOVERY PASS (read-only)
**Область:** CRM Companies 1.0, backfill из `public.client_legal_details` (CLD) в canonical слой (`public.companies`, `public.client_legal_details_company_map`, `public.company_contacts`).
**Режим выполнения discovery:** read-only. Никаких DDL/DML не выполнялось.

---

## 1. Источник истины

- **Основная таблица-источник:** `public.client_legal_details` (CLD).
- **Целевые таблицы:**
  - `public.companies` — canonical компания.
  - `public.client_legal_details_company_map` — маппинг CLD → company. Единственный `UNIQUE` — `client_legal_details_id`. `id UUID`; собственной sequence у таблицы **нет**.
  - `public.company_contacts` — контакты компании (billing помечается `relationship_type='billing_contact'` и `is_billing_contact=true`).
- **RPC-контракт (Phase 2):**
  - `crm_company_upsert_from_billing` — создаёт/обновляет **только** `public.companies`; жёстко использует `country='BY'`; **не создаёт** запись в `client_legal_details_company_map`; **не создаёт** `company_contacts`; **не пишет** `metadata.country_source`.
  - `crm_company_link_contact` — создаёт/обновляет запись в `public.company_contacts`.
  - Для `public.client_legal_details_company_map` **RPC отсутствует**.
- **Country resolution:** поле `country` в CLD отсутствует. Значение `BY` задаётся жёстко внутри `crm_company_upsert_from_billing`. Метка `inferred_by_domain` **не** является текущим postcondition и в canonical метаданных не сохраняется; фиксация факта инференса — в execution ledger/report фазы 3C (если в Phase 3B не будет отдельно одобрен writer, пишущий такую метку).

---

## 2. Инвентаризация источника

| Метрика | Значение |
|---|---|
| Всего строк в `client_legal_details` | **48** |
| Eligible для backfill (валидный UNP из 9 цифр) | **17** |
| Из них `legal_entity` | 7 |
| Из них `entrepreneur` | 10 |
| Не eligible / отфильтровано | 31 |

---

## 3. Прогноз canonical объектов

| Сущность | Кол-во | Комментарий |
|---|---|---|
| `public.companies` (unique UNP) | **16** | Дедупликация по UNP |
| `public.client_legal_details_company_map` | **17** | По одной записи на каждую eligible CLD-строку; `UNIQUE(client_legal_details_id)` |
| `public.company_contacts` (`relationship_type='billing_contact'`, `is_billing_contact=true`) | **17** | По одной записи на CLD-профиль |

---

## 4. Ambiguities: 0 hard data blockers, ровно 1 soft-flag

### 4.1 SOFT-FLAG — один UNP на двух профилях
- **UNP:** `193405000`.
- **Профилей:** 2.
- **Результат backfill:** 1 canonical `companies` + 2 `company_contacts` (`relationship_type='billing_contact'`, `is_billing_contact=true`), по одному на каждый профиль.
- **Классификация:** **единственный soft-flag**. Не блокирует backfill. Явно фиксируется в rehearsal и в execution ledger.

### 4.2 Штатный сценарий — один профиль с двумя разными UNP
- **Профилей:** 1.
- **Результат backfill:** 2 canonical `companies` (по одной на каждый UNP), 2 записи в `client_legal_details_company_map`.
- **Классификация:** **штатный сценарий** канонической модели (один профиль может владеть несколькими юр. лицами). **Не** soft-flag.

### 4.3 Отсутствие `country` в источнике
- **Резолюция:** `BY` жёстко задан в `crm_company_upsert_from_billing`.
- **Классификация:** штатное поведение контракта; факт инференса — только в execution ledger/report.

---

## 5. Аудит целевых (canonical) таблиц

| Таблица | Строк | Sequence |
|---|---|---|
| `public.companies` | 0 | `public_id_sequences.company = 0` |
| `public.client_legal_details_company_map` | 0 | отсутствует (`id UUID`, собственной sequence нет) |
| `public.company_contacts` (billing_contact) | 0 | — |

Конфликтов с существующими данными нет. Backfill выполняется на чистый canonical слой.

---

## 6. Hard blockers

**0 hard data blockers.**
Ровно **1 soft-flag** (см. §4.1). Штатный сценарий из §4.2 к soft-flag не относится.

---

## 7. Execution-identity gate (важно для Phase 3B/3C)

Существующие Phase 2 RPC имеют **разные identity-требования**, поэтому один единый service-role вызов не выполняет все три действия backfill. **Возможность объединить разные identity в одну транзакцию — предмет доказательства в identity rehearsal и не должна утверждаться заранее.**

| Действие | Механизм | Разрешённая identity |
|---|---|---|
| Upsert в `public.companies` | `crm_company_upsert_from_billing` | `service_role` |
| Вставка в `public.client_legal_details_company_map` | **RPC отсутствует** | controlled, run-tagged SQL под управляемой транзакцией **или** отдельный внутренний writer |
| Вставка в `public.company_contacts` | `crm_company_link_contact` | `authenticated` + role guard `admin` / `super_admin` / `menedzher` |

**Идемпотентный map-writer** (единственное контролируемое исключение из отсутствующего map RPC): сначала `SELECT` по `client_legal_details_id`, сверка ожидаемого `company_id`; при несовпадении — немедленный `abort` как conflict; `INSERT` выполняется **только** когда запись отсутствует. Каждый map INSERT фиксируется в execution ledger с точными cleanup id.

**Следствие:** до rehearsal Phase 3B обязан выбрать и доказать в rollback-only режиме **один согласованный способ** оркестрации:
- (a) controlled, run-tagged SQL под управляемой транзакцией — с проверяемым admin JWT для `crm_company_link_contact` и с map INSERT как контролируемым исключением (ledger + exact cleanup IDs), либо
- (b) новый узкий internal service writer, покрывающий все три действия, — **только после отдельного approval**.

---

## 8. Стратегия волн

- **Волна 1:** 16 уникальных UNP → 16 `companies` + 16 `client_legal_details_company_map` + 16 `company_contacts` (billing).
- **Волна 2:** 1 повторный UNP (`193405000`) → 0 новых `companies` (идемпотентный upsert), +1 map, +1 billing contact.
- **Итого после двух волн:** 16 companies, 17 maps, 17 billing contacts.

Порядок волн важен для явной верификации идемпотентности `crm_company_upsert_from_billing`.

---

## 9. DoD discovery

- [x] Полный inventory CLD (48/17).
- [x] Прогноз canonical (16/17/17) на реальных именах таблиц.
- [x] Ambiguities классифицированы: 0 hard, 1 soft-flag, 1 штатный сценарий, 1 доменный default.
- [x] Baseline canonical подтверждён пустым; учтено отсутствие собственной sequence у map.
- [x] Стратегия волн зафиксирована.
- [x] Execution-identity gate явно описан (включая ограничение по объединению identity в одну транзакцию).
- [x] Никакие данные не изменены; DDL/DML не выполнялись.

---

## 10. Следующий шаг

Phase 3B — подготовка runnable-плана backfill **и** rollback-only rehearsal (без исполнения на реальных данных). Phase 3C (реальное выполнение) — **только после отдельного admin approval**.
