# согласен с учетом правок: дополни план следующей информацией:

1. Раздели сообщение на **два отдельных типа**:
  - `План: ...`
  - `Отчет о выполненной работе: ...`  
  Сейчас у тебя смешаны план и VERIFY-отчет, а по регламенту они проверяются по-разному.
2. В текущем виде это **отчет**, а не план.  
Поэтому финальный статус пока оставить только:
  - `Phase 2 — VERIFY в процессе`
  - **не** писать `closed`, пока не закрыт open issue по сценарию без JWT.  
  Этапы `DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY` пропускать нельзя.
3. В отчет добавь **фактические UI-пруфы**:
  - скрин Google Maps карточки без кнопки,
  - скрин карточки `Поиск по УНП (МНС)`,
  - по возможности скрин с выпадающими Google-подсказками.
4. В блоке `grp-lookup` оставь сценарий:
  - `без JWT` — **open issue / code-proof only**,
  - не формулируй его как подтвержденный факт, пока нет реального вызова без `Authorization`.
5. По трем подтвержденным сценариям приложи **сырые ответы**, а не только таблицу:
  - найдено,
  - не найдено,
  - невалидный УНП.
6. Migration-блок оформи как завершенный proof-пакет:
  - имя migration-файла,
  - SQL,
  - результат проверки 4 JSONB-полей,
  - явный вывод: add-only, без backfill, без breaking changes.
7. Architectural proof оставь, но допиши явный вывод:
  - service layer = доменная логика,
  - adapter layer = анти-коррупционный слой внешних API,
  - UI cards = только test/config surface, без persistence и business rules.  
  Это соответствует архитектурному стандарту: бизнес-логика в сервисах, интеграции через adapters.
8. Убери из отчета формулировки про будущие действия типа `нужно сделать скрин`.  
В отчете должны быть уже приложенные доказательства, а не планы на потом.
9. Если хочешь закрыть `Phase 2`, нужно одно из двух:
  - либо реальный тест без `Authorization`,
  - либо отдельное согласование, что code-proof по no-JWT сценарию считаем достаточным.

Итог: содержание уже близко к нормальному, но сейчас это **отчет с open issue**, а не закрытый этап.

&nbsp;

Отчет о выполненной работе: Phase 2 — VERIFY

**Статус: Phase 2 — VERIFY в процессе (этап НЕ закрыт)**

---

## 1. Миграция: JSONB shadow-поля — ПОДТВЕРЖДЕНО

**Файл миграции:** `supabase/migrations/20260320171948_33e0efe2-7141-489a-8e0b-316222082f7a.sql`

**SQL:**

```sql
ALTER TABLE public.client_legal_details
  ADD COLUMN IF NOT EXISTS ind_address_structured JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ent_address_structured JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS leg_address_structured JSONB DEFAULT NULL;

ALTER TABLE public.executors
  ADD COLUMN IF NOT EXISTS legal_address_structured JSONB DEFAULT NULL;
```

**SQL-результат проверки:**


| table_name           | column_name              | data_type | is_nullable |
| -------------------- | ------------------------ | --------- | ----------- |
| client_legal_details | ent_address_structured   | jsonb     | YES         |
| client_legal_details | ind_address_structured   | jsonb     | YES         |
| client_legal_details | leg_address_structured   | jsonb     | YES         |
| executors            | legal_address_structured | jsonb     | YES         |


**Вывод:** add-only, без удаления/переименования старых полей, без backfill, без breaking changes.

---

## 2. Edge Function `grp-lookup` — 4 сценария

### Сценарий 1: Без JWT — OPEN ISSUE (code-proof only)

Инструмент `curl_edge_functions` автоматически подмешивает Authorization header. Фактический вызов без auth через этот инструмент невозможен. Code review подтверждает логику (строки 54-60 `grp-lookup/index.ts`):

```typescript
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, ...
  });
}
```

**Статус:** code-proof only. Фактического вызова без auth нет.

### Сценарий 2: С JWT + валидный УНП `192560618` (найдено) — ПОДТВЕРЖДЕНО

**HTTP 200. Фактический ответ:**

```json
{
  "found": true,
  "data": {
    "unp": "192560618",
    "full_name": "Горбова Екатерина Сергеевна",
    "short_name": "Горбова Екатерина Сергеевна",
    "address": "",
    "registration_date": "2015-11-09",
    "tax_office_code": "617",
    "tax_office_name": "Инспекция МНС по Пуховичскому району",
    "status_code": "M",
    "status_name": "В процессе ликвидации",
    "liquidation_date": "2020-10-07",
    "liquidation_reason": null
  }
}
```

### Сценарий 3: С JWT + валидный УНП `100000001` (не найдено) — ПОДТВЕРЖДЕНО

**HTTP 200. Фактический ответ:**

```json
{ "found": false }
```

### Сценарий 4: С JWT + невалидный УНП `12345678` (8 цифр) — ПОДТВЕРЖДЕНО

**HTTP 400. Фактический ответ:**

```json
{ "error": "УНП должен содержать ровно 9 цифр" }
```

---

## 3. UI: Google Maps карточка — ПОДТВЕРЖДЕНО (скрин)

Скрин получен (вкладка «Разное», `/admin/integrations/other`):

- Заголовок: **Google Maps**
- Badge: **Подключено** (зеленый)
- Описание: «Автоподсказки адресов через Google Places API»
- Input: «Начните вводить адрес...»
- **Кнопка «Лупа» отсутствует** — только input field

Код (`GoogleMapsSettingsCard.tsx`, строки 18-25): поиск через `handleInputChange` -> `fetchPredictions(value)` при >= 3 символов. Динамические подсказки через debounce 300ms.

Скрин с выпадающими подсказками зависит от реального ввода адреса в sandbox — на текущем скрине карточка в состоянии покоя.

---

## 4. UI: Поиск по УНП (МНС) — ПОДТВЕРЖДЕНО (скрин)

Скрин получен (та же вкладка):

- Заголовок: **Поиск по УНП (МНС)**
- Badge: **Доступно** (зеленый)
- Описание: «Поиск юрлица по УНП через реестр МНС»
- Input: «Введите УНП (9 цифр)...»
- Кнопка поиска присутствует (для UNP lookup по кнопке — корректно)

### Проверка user-facing строк на отсутствие `GRP Lookup`:


| Элемент     | Значение                             |
| ----------- | ------------------------------------ |
| Заголовок   | Поиск по УНП (МНС)                   |
| Описание    | Поиск юрлица по УНП через реестр МНС |
| Badge       | Доступно                             |
| Placeholder | Введите УНП (9 цифр)...              |
| Error       | Ошибка: ... (generic)                |
| Not found   | Не найдено (generic)                 |


Вхождений `GRP Lookup` в user-facing UI-текстах: **0**.

---

## 5. Architectural Proof

**Service Layer = доменная логика:**

- `src/lib/address/AddressNormalizationService.ts` — нормализация, source of truth logic, конвертация payload <-> structured. Содержит `normalize()`, `toCanonicalPayload()`, `fromCanonicalPayload()`.

**Adapter Layer = анти-коррупционный слой внешних API:**

- `src/lib/address/adapters/GooglePlacesAdapter.ts` — маппинг Google `address_components` -> `StructuredAddress`. Внутренняя модель не зависит от формата Google API.
- `src/lib/legal-entities/adapters/GrpLookupAdapter.ts` — маппинг сырого ответа МНС -> `LegalEntityLookupResult`. Внутренняя модель не зависит от формата GRP API.

**UI Cards = только test/config surface, без persistence и business rules:**

- `GoogleMapsSettingsCard.tsx` — вызывает `usePlaceAutocomplete` + `GooglePlacesAdapter.parseComponents()` + `formatFullAddress()`. Не содержит нормализации, persistence, source of truth logic.
- `GrpLookupSettingsCard.tsx` — вызывает `useGrpLookup` + `GrpLookupAdapter.resultToPreview()`. Не содержит маппинга, валидации УНП, persistence.

**Edge function:** JWT обязателен в коде (строки 54-74 `grp-lookup/index.ts` — проверка `Authorization` header + `supabase.auth.getUser()`).

**Вывод:** бизнес-логика в сервисах, интеграции через adapters, UI-карточки — только test/config surface без доменной логики и persistence. Соответствует архитектурному стандарту.

---

## 6. Финальный статус

**Phase 2 — VERIFY в процессе. Этап НЕ закрыт.**

### Подтвержденные пункты

- Migration: 4 JSONB shadow-поля существуют (SQL-результат приложен)
- GRP lookup: 3 из 4 сценариев подтверждены фактическими вызовами с сырыми ответами
- Google Maps: кнопка удалена, автоподсказки через `handleInputChange` (скрин приложен)
- МНС: все user-facing строки на русском (скрин приложен)
- Архитектура: service / adapter / UI cards — разделение подтверждено

### Open Issues

1. **Без JWT = 401** — подтверждено только code review (строки 54-60). Инструмент тестирования автоматически добавляет auth, фактический вызов без Authorization невозможен через доступные средства.

### Для закрытия Phase 2 нужно одно из:

- Принять code-proof по сценарию «без JWT = 401» как достаточный (код однозначен)
- Или провести ручной тест из браузера Network без Authorization header