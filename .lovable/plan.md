да, согласен, с учетом правок:

1. Убери из плана расплывчатость `если потребуется аналогично для city`.  
Здесь нужен **жёсткий reset-rule**, а не условный.  
Зафиксируй так:
  - при начале нового поиска по `street` очищаются:
    - `house`
    - `building`
    - `apartment`
    - `postal_code`
    - `google_place_id`
    - `lat`
    - `lng`
  - при явном изменении `city` для нового адреса тоже очищаются stale meta и не подмешивается старый адресный хвост.
2. Зафиксируй, что **manual и auto path используют один и тот же helper/contract**, а не просто “похожие ветки”.  
Нужно явно написать:
  - один shared helper для `Google place details -> StructuredAddress`;
  - один `GooglePlacesAdapter.parseComponents(...)`;
  - один набор place fields;
  - одинаковое формирование canonical address.
3. В пункте про validated candidate selection добавь явный **fail-safe**:
  - если ни один Google candidate не проходит match,
  - сохраняем `GRP parsed address` как canonical base,
  - ничего из Google автоматически не применяем, включая `postal_code`, `place_id`, `lat/lng`.
4. В VERIFY добавь отдельный пункт **after manual save + reopen** для второго адреса.  
Сейчас есть проверка поиска второго адреса, но нужно еще доказать:
  - второй адрес после сохранения и повторного открытия не смешивается с первым;
  - stale context не возвращается.
5. Для ИП в DoD зафиксируй итоговое состояние не только в VERIFY, но и как обязательный результат:
  - `org_form = Индивидуальный предприниматель`
  - руководитель скрыт
  - `acts_on_basis = свидетельства о государственной регистрации`
  - `client_type = entrepreneur` после save
  - after reopen читается из `ent_*`, без хвостов `leg_*`.
6. Добавь строку `no regression` для manual flow `Другое`, раз он не в scope:
  - `Другое` не трогаем, но не ломаем;
  - existing save/reopen должен остаться рабочим.

В остальном план хороший и ТЗ покрывает.

&nbsp;

PATCH 3.2.6 — Единый Google pipeline для индекса + жёсткий reset stale context

## DIAGNOSE

По коду и по присланным скринам сейчас картина такая:

1. Что уже реально работает:

- unified-блок `Организация / ИП` есть;
- `дом 2` для ЮЛ уже доезжает;
- ИП-режим в текущем коде уже умеет становиться `ИП`, скрывать руководителя и ставить основание, если lookup классифицирован как `entrepreneur`.

2. Что реально не закрыто:

- индекс не заполняется;
- ручной и auto-flow работают через разные Google-path;
- второй ручной адрес ищется с хвостами старого контекста.

3. Точный root cause по индексу:

- в `GrpAddressEnricher.ts` индекс пытаются брать из Google (`postal_code` / `postalCode`);
- но ручной path в `usePlaceAutocomplete.fetchPlaceDetails()` запрашивает только:
`addressComponents`, `formattedAddress`, `location`, `id`
— без `postalCode`;
- `StructuredAddressBlock.handleSelect()` потом мержит только то, что вернул `GooglePlacesAdapter.parseComponents(...)`;
- значит ручной Google autocomplete физически не может стабильно дотащить индекс;
- а по УНП для кейса `193405000` МНС в network logs возвращает адрес **без индекса**, значит индекс должен приходить именно из Google.

4. Вторая системная проблема:

- GRP enrichment и ручной autocomplete сейчас используют похожие, но не одинаковые ветки получения place details;
- из-за этого “ручной выбор из Google” и “автозаполнение после УНП” дают разный результат, что противоречит ТЗ.

5. Stale context всё ещё недочищен:

- `buildAutocompleteQuery()` для `street` всё ещё подмешивает `city/region/country`;
- при старом адресе это даёт смешанный query;
- для нового поиска по улице пользователь фактически начинает новый адрес, а не уточняет старый.

## DESIGN

Нужен не новый flow, а выравнивание одного общего адресного pipeline:

```text
UNP lookup / manual typing
        ↓
shared Google place details pipeline
        ↓
GooglePlacesAdapter.parseComponents(...)
        ↓
canonical StructuredAddress
        ↓
save via existing adapters
```

Главный принцип:

- ручной ввод и УНП-обогащение должны использовать один и тот же Google result pipeline;
- индекс, регион, страна, place_id, lat/lng должны извлекаться одинаково;
- конфликтующий Google candidate не применяется;
- если пользователь начинает новый адрес, старый контекст не должен влиять на поиск.

## EXECUTE

### 1. Убрать расхождение между manual и auto Google paths

Файлы:

- `src/hooks/usePlaceAutocomplete.ts`
- `src/components/shared/StructuredAddressBlock.tsx`
- при необходимости `src/lib/address/adapters/GooglePlacesAdapter.ts`

Что сделать:

- расширить `fetchPlaceDetails()` так, чтобы он запрашивал тот же набор place fields, что нужен для enrichment, включая `postalCode`;
- вернуть из него все данные, нужные для канонического адреса, а не только минимальный набор;
- в `StructuredAddressBlock.handleSelect()` применять этот результат так, чтобы индекс тоже попадал в `StructuredAddress`;
- не делать отдельный “обрезанный” manual-path без индекса.

Ожидаемый результат:

- ручной выбор из Google начинает заполнять индекс тем же путём, что и auto normalization.

### 2. Сделать общий reusable Google normalization result

Файлы:

- `src/lib/address/GrpAddressEnricher.ts`
- `src/hooks/usePlaceAutocomplete.ts`
- возможно новый shared helper в address-layer

Что сделать:

- вынести общий helper/contract для Google place details → `StructuredAddress`;
- использовать тот же `GooglePlacesAdapter.parseComponents(...)` и одинаковый набор полей и для manual select, и для GRP→Google enrichment;
- сохранить fail-safe: если Google невалиден, остаётся GRP base address.

Ожидаемый результат:

- after-UNP normalization и manual Google selection дают одинаково качественный canonical result.

### 3. Дожать validated candidate selection для УНП

Файл:

- `src/lib/address/GrpAddressEnricher.ts`

Что сделать:

- оставить перебор top candidates до первого валидного;
- валидность: совпадают `street + city`, и `house` не конфликтует;
- только от валидного кандидата брать:
  - `postal_code`
  - `region`
  - `country`
  - `place_id`
  - `lat/lng`
- `apartment/office` всегда оставлять из GRP parser поверх Google;
- если ни один candidate не валиден — Google не применять вообще.

Ожидаемый результат:

- индекс не “угадывается” от чужого адреса;
- `Панфилова / 2 / 49л` сохраняются, индекс приходит только от подтверждённого Google match.

### 4. Жёстко исправить stale context при новом ручном адресе

Файлы:

- `src/lib/address/utils.ts`
- `src/components/shared/StructuredAddressBlock.tsx`

Что сделать:

- для нового поиска по `street` строить safe-query как новый поиск:
  - `activeValue`
  - максимум `activeValue + country`
  - без старых `house/building/apartment/postal_code`
  - без заведомо stale `city/region`, если пользователь уже меняет улицу на новый адрес;
- при ручном изменении `street` очищать stale address-tail:
  - `house`
  - `building`
  - `apartment`
  - `postal_code`
  - `google_place_id`
  - `lat`
  - `lng`
- при необходимости аналогично пересматривать очистку для `city`, если пользователь явно начинает новый адрес.

Ожидаемый результат:

- второй адрес ищется как новый, а не как смесь прошлого и текущего.

### 5. Не сломать unified Organization/IP form

Файл:

- `src/components/legal-details/OrganizationDetailsForm.tsx`

Что проверить при внедрении:

- ИП autofill не регрессирует;
- `org_form = Индивидуальный предприниматель` остаётся;
- блок руководителя скрыт;
- `acts_on_basis = свидетельства о государственной регистрации`;
- save/load остаются по `client_type`, без хвостов из opposite namespace.

## VERIFY

Новый verify должен закрывать именно фактические баги.

### A. ЮЛ по УНП

Кейс: `193405000`

Проверить:

- after lookup
- after Google normalization
- after save
- after reopen

Доказать:

- `ул. Панфилова`
- `дом 2`
- `49л`
- индекс заполнен
- регион/страна заполняются корректно
- адрес не подменяется чужим candidate

### B. ИП по УНП

Кейс: `192560618`

Проверить:

- after lookup
- after save
- after reopen

Доказать:

- форма = `Индивидуальный предприниматель`
- имя без префикса и без кавычек
- руководитель скрыт
- основание = `свидетельства о государственной регистрации`
- reopen идёт как `entrepreneur`, без хвостов ЮЛ

### C. Manual Google

Проверить ручной выбор того же адреса через autocomplete.

Доказать:

- ручной Google теперь заполняет индекс;
- canonical result не хуже auto-flow после УНП;
- place_id / lat / lng / postal_code сохраняются одинаково качественно.

### D. Второй адрес после первого

Проверить:

- сначала выбрать один адрес;
- затем начать новый поиск по другой улице/другому адресу.

Доказать:

- autocomplete не тащит старый контекст;
- второй адрес ищется и выбирается корректно;
- старые `дом / индекс / квартира / place_id` не подмешиваются.

## SCOPE

- без новых таблиц;
- без миграций;
- без новых backend functions;
- только bugfix существующего unified settings flow и выравнивание shared address pipeline.

## DoD

- ручной Google autocomplete заполняет индекс;
- after-UNP normalization использует тот же Google pipeline, что и ручной выбор;
- индекс для ЮЛ приходит от валидного Google candidate, а не от конфликтующего адреса;
- `Панфилова / 2 / 49л` не теряются;
- второй ручной адрес не наследует stale context первого;
- unified ИП-flow не регрессирует и корректно сохраняется/reopen по `client_type`.