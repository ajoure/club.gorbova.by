# CRM Companies — Phase 3A Backfill Discovery Report

**Версия:** 1.0
**Статус:** DISCOVERY PASS (read-only)
**Область:** CRM Companies 1.0, backfill из `public.client_legal_details` (CLD) в canonical слой (`companies`, `maps`, `contacts`).
**Режим выполнения discovery:** read-only. Никаких DDL/DML не выполнялось.

---

## 1. Источник истины

- **Основная таблица-источник:** `public.client_legal_details` (CLD).
- **Целевые таблицы:** `public.companies`, `public.maps`, `public.contacts`.
- **RPC-контракт (Phase 2):** `crm_company_get_or_create`, `crm_company_link_contact`, billing upsert helpers.
- **Country resolution:** поле `country` в CLD отсутствует → выводится доменно как `BY` (`inferred_by_domain`).

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
| `companies` (canonical, unique UNP) | **16** | Дедупликация по UNP |
| `maps` (CLD → company mapping) | **17** | По одной карте на каждую eligible CLD-строку |
| `contacts` роли `billing_contact` | **17** | По одному контакту на CLD-профиль |

---

## 4. Ambiguities и soft-flags

### 4.1 Один UNP на двух профилях (SOFT-FLAG)
- **UNP:** `193405000`
- **Профилей:** 2
- **Результат backfill:** 1 canonical `company` + 2 `billing_contact` (по одному на каждый профиль).
- **Классификация:** soft-flag, не блокирует backfill. Требует явной фиксации в rehearsal.

### 4.2 Один профиль с двумя CLD (разные UNP)
- **Профилей:** 1
- **Результат backfill:** 2 canonical `company` (по одной на каждый UNP), 2 `map`.
- **Классификация:** штатный сценарий канонической модели, не блокирует.

### 4.3 Отсутствует `country` в источнике
- **Резолюция:** значение `BY` устанавливается как `inferred_by_domain`.
- **Классификация:** штатное поведение доменной модели.

---

## 5. Аудит целевых (canonical) таблиц

| Таблица | Строк | Sequence |
|---|---|---|
| `companies` | 0 | 0 |
| `maps` | 0 | 0 |
| `contacts` (canonical) | 0 | — |

Конфликтов с существующими данными нет. Backfill выполняется на чистый canonical слой.

---

## 6. Hard blockers

**0 hard blockers.**
Все выявленные аномалии классифицированы как soft-flag и покрываются штатным поведением RPC-контракта (идемпотентность + advisory locks из Phase 2).

---

## 7. Стратегия волн

- **Волна 1:** 16 уникальных UNP → 16 companies + 16 maps + 16 billing contacts.
- **Волна 2:** 1 повторный UNP (`193405000`) → 0 новых companies (идемпотентный get_or_create), +1 map, +1 billing contact.
- **Итого после двух волн:** 16 companies, 17 maps, 17 billing contacts.

Порядок волн важен для явной верификации идемпотентности `crm_company_get_or_create`.

---

## 8. DoD discovery

- [x] Полный inventory CLD (48/17).
- [x] Прогноз canonical (16/17/17).
- [x] Ambiguities перечислены и классифицированы (0 hard, 2 soft, 1 domain default).
- [x] Baseline canonical подтвержден пустым.
- [x] Стратегия волн зафиксирована.
- [x] Никакие данные не изменены; DDL/DML не выполнялись.

---

## 9. Следующий шаг

Phase 3B — подготовка runnable-плана backfill (только план, без исполнения). Phase 3C (реальное выполнение) — **только после отдельного admin approval** и обязательного rollback-only rehearsal.
