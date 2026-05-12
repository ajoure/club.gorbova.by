## Да, ощущение правильное: в плане появилась опасная подмена фокуса.

Изначальный Sprint D был про **корректный рендер существующих адресных плейсхолдеров**:

```text
customer.address
executor.address
```

А теперь он добавил:

```text
customer.address.full
executor.address.full
```

Это допустимо **только как add-on**, но не должно заменить основную задачу. Основной DoD должен оставаться вокруг `customer.address` и `executor.address`.

Дай ему такую ревизию:

```text
Да, план в целом согласован, но с обязательными правками. Не уходить от первоначального Sprint D.

## Главное уточнение

Sprint D — это НЕ sprint по новым плейсхолдерам.

Sprint D — это патч рендера существующих адресов:

- customer.address
- executor.address

Новые алиасы:

- customer.address.full
- executor.address.full

можно добавить только как дополнительный alias-layer, но они не заменяют основную задачу.

## Что обязательно сохранить из первоначального плана

1. Основной результат должен быть в существующих токенах:

customer.address
executor.address

Именно они должны начать рендериться из structured JSONB.

2. Source priority остается:

legal_entity:
leg_address_structured → leg_address raw → empty + warning

entrepreneur:
ent_address_structured → ent_address raw → empty + warning

individual:
ind_address_structured → текущая сборка из ind_address_* → raw fallback

executor:
legal_address_structured → legal_address raw → empty + warning

3. Правильный порядок адреса:

улица → дом → корпус → помещение/квартира → населённый пункт → индекс → район/область только если нужно → страна

Пример:

ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь

НЕ:

220035, Республика Беларусь, г. Минск, ул. Панфилова, д. 2, пом. 49л

4. Region/district:

Не добавлять район/область для Минска и областных центров, если уже есть город + индекс + страна.

Не должно быть:

ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Центральный район, Минский район, Минская обл., Республика Беларусь

Должно быть:

ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь

5. Sub-token’ы вида:

customer.address.street
customer.address.house
executor.address.city

НЕ вводить в этом спринте, если их нет в document_token_registry.

Сначала только discovery. Если токенов нет — отдельный patch позже.

6. Алиасы full:

customer.address.full
executor.address.full

можно добавить только если:
- они есть или будут корректно зарегистрированы в document_token_registry;
- они просто равны customer.address / executor.address;
- они не требуют новой логики;
- они не ломают unresolved_count.

Если registry seed для них затягивает спринт — убрать из Sprint D и вынести отдельно.

## Что НЕ делать в этом Sprint D

Не трогать:

- payment.*
- document.number
- payer_type cohort logic
- document scenarios
- aliases payer/service/order
- payments_v2
- orders_v2
- client_legal_details schema
- executors schema
- morph/case modifiers
- PDF/DOCX generator architecture

## Исправить пункт про document-data-snapshot

Фраза:

Renderer-priority: live row → snapshot → raw fallback

опасная.

Нужно использовать существующую архитектуру без смены глобального порядка.

Правильно:

1. Если в текущем pipeline renderer получает live customer/executor row — использовать structured из live row.
2. Если renderer работает из snapshot — использовать snapshot.address.
3. Не менять глобальный snapshot-first/live-first порядок всего renderer-а в этом спринте.
4. Address block в snapshot нужен для воспроизводимости, но не должен ломать текущий overlay.

## Исправить DoD

DoD должен быть таким:

1. customer.address для legal_entity со structured:
   ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь

2. executor.address со structured:
   ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь

3. individual со structured:
   ул. Сухая, д. 15, кв. 26, г. Брест, 224032, Республика Беларусь

4. Сельский адрес:
   ул. Центральная, д. 12, д. Клунь, 223016, Минский р-н, Минская обл., Республика Беларусь

5. Старый order без structured:
   customer.address / executor.address не пустеют, берутся из raw fallback.

6. Для Минска нет административного хвоста:
   Центральный район / Минский район / Минская обл.

7. unresolved_count = 0.

8. deno check clean.

9. payments_v2 checksum identical.

10. Если добавлены customer.address.full / executor.address.full:
   - они есть в registry;
   - они равны customer.address / executor.address;
   - они не создают новые source rules;
   - если их нет в registry — не добавлять в smoke.

## Итоговая команда

Реализуй Sprint D строго как патч structured rendering для customer.address и executor.address.

Алиасы customer.address.full / executor.address.full — только add-only, если не мешают и проходят registry/discovery. Если мешают — вынести в отдельный patch.
```

Коротко: **он не должен превращать Sprint D в новый namespace/alias sprint**. Основная задача — чтобы уже существующие `customer.address` и `executor.address` стали красивыми и правильными.

&nbsp;

Sprint D — Structured Addresses (исправленный порядок)

### Цель

Резолвить `customer.address` и `executor.address` из structured-полей с правильным белорусским порядком: **улица → дом → корпус → помещение → населённый пункт → индекс → район/область (только сельские) → страна**.

Дополнительно: ввести единый placeholder `customer.address.full` / `executor.address.full` (синоним `address`), чтобы шаблоны могли вставлять собранный адрес одной подстановкой.

### Канонический порядок

```
ул. Панфилова, д. 2, корп. 1, пом. 49л, г. Минск, 220035, Республика Беларусь
```

Не: `220035, Республика Беларусь, г. Минск, ...`

### Префиксы apartment по subject_type

- `legal_entity`, `executor` → `пом.`
- `individual` → `кв.`
- если в structured есть явный тип (office/room) → `оф.` / `пом.`

### Region/district

Скрывать для Минска и облцентров (если есть city + индекс + страна). Показывать только для сельских адресов (settlement_type = `д.`, `аг.`, `п.`, `г.п.`).

### Country

Не добавлять, если в structured/raw его нет.

### Source priority по subject_type

- **legal_entity** → `leg_address_structured` → `leg_address` raw → empty + warning.
- **entrepreneur** → `ent_address_structured` → `ent_address` raw.
- **individual** → `ind_address_structured` → текущая сборка из `ind_address_*` → raw fallback.
- **executor** → `executors.legal_address_structured` → `executors.legal_address` raw.

### Реализация

1. **Helper** в `supabase/functions/_shared/address-format.ts`:
  ```ts
   formatStructuredAddress(struct, fallback, { subject_type })
  ```
   Алгоритм: street_type+street → house → building → apartment(с префиксом по subject_type) → settlement_type+settlement|city|locality → postal_code → [district, region если сельский] → country. Дедуп префиксов (нет `ул. ул.`, `г. г.`, `д. д.`).
2. `**document-render.ts**`:
  - `buildCustomerAddress(ld)` — branch по `payer_type`, использовать helper.
  - `executor.address` — использовать helper.
  - Зарегистрировать токены `customer.address.full` и `executor.address.full` как алиасы `customer.address` / `executor.address` (для семантической ясности в шаблонах).
3. `**document-data-snapshot.ts**`:
  - В snapshot блоке customer/executor добавить `address: { rendered, structured, raw, source }`.
  - Renderer-priority: live row → snapshot → raw fallback (не ломает существующую логику snapshot-first).
4. **Sub-tokens (street/house/city/...)** — НЕ вводить в этом спринте. Сначала discovery `document_token_registry`. Если sub-token'ов нет — отдельный patch с registry seed.
5. **Source trace** — точечно для существующих ключей:
  - `customer.address` → `client_legal_details.<structured|raw|missing>`
  - `executor.address` → `executors.<structured|raw|missing>`

### STOP (не трогать)

`payment.*`, `customer.*` (кроме address), `payer_type` cohort, `document.number`, `payments_v2`, схему `client_legal_details` / `executors`, `ind_address_*` колонки.

### DoD

1. legal_entity со structured: `ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь`.
2. individual со structured: `ул. Сухая, д. 15, кв. 26, г. Брест, 224032, Республика Беларусь`.
3. Сельский: `ул. Центральная, д. 12, д. Клунь, 223016, Минский р-н, Минская обл., Республика Беларусь`.
4. **Старый order без `*_address_structured**` — `customer.address` / `executor.address` рендерятся из raw, не пустеют (regression).
5. Missing legal row — non-blocking warning, document не падает.
6. Минск/облцентр — нет хвоста "Центральный район, Минский район, Минская обл.".
7. `customer.address.full` / `executor.address.full` доступны как алиасы.
8. `unresolved_count = 0` в smoke.
9. `payments_v2` checksum identical.
10. `deno check` clean.

### Smoke

- Order legal_entity со structured (Панфилова) → проверить порядок.
- Order legal_entity без structured (raw fallback) → не пусто.
- Order individual → префикс `кв.`.
- Сравнить `customer.address` и `customer.address.full` — идентичны.