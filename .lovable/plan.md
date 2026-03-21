Да, согласен, с учетом правок:

План стал заметно лучше и **почти полностью покрывает текущее ТЗ**.  
Ключевые баги ты поймал правильно:

- `house` теряется в цепочке `parse → apply`;
- для ИП нет `entity_kind` и из-за этого остается старое `ЗАО`;
- switch-flow должен жить на уровне страницы, а не внутри формы.

Но я бы добавил еще несколько обязательных правок, чтобы потом не было нового круга багов.

## Что добавить в план

### 1. Добавить **handoff state** при переключении ЮЛ → ИП

Сейчас ты пишешь:

- `LegalEntityDetailsForm` вызывает callback наверх;
- `LegalDetails.tsx` переключает `selectedType` на `entrepreneur`;
- в форму ИП передаются нормализованные значения lookup.

Это правильно, но нужно **явно** зафиксировать механизм:

- page-level state хранит `pendingGrpAutofillPayload`;
- после switch на `entrepreneur` этот payload один раз применяется в `EntrepreneurDetailsForm`;
- потом payload очищается, чтобы не было повторного автоприменения при следующем рендере/reopen.

Иначе высок риск, что:

- либо данные ИП потеряются при переключении,
- либо применятся повторно,
- либо останется старый state формы ЮЛ.

### 2. При switch ЮЛ → ИП нужно явно чистить legacy state ЮЛ

Нужно дописать:

- при подтвержденном switch-flow старые поля юрлица не должны оставаться в памяти формы;
- как минимум очищаются:
  - `leg_org_form`
  - `leg_name`
  - `leg_address*`
  - связанные autofill badges/state
- адресный state ЮЛ тоже сбрасывается.

Иначе можно снова получить визуальный хвост вроде `ЗАО`.

### 3. Для `LegalEntityDetailsForm` зафиксировать apply от **empty canonical state**

Ты это уже частично написал, но я бы сделал формулировку жестче:

- новый адрес после GRP apply строится от `emptyAddress() + parsed GRP fields`;
- не допускается merge с предыдущим address state формы до завершения parser/apply;
- enrichment работает уже поверх этого нового canonical address.

Это как раз исключает сценарий, когда старый `дом 19` переживает новый `дом 2`.

### 4. Добавить verify для **switch-flow**

Сейчас verify хороший, но не хватает отдельного кейса:

- пользователь находится в форме ЮЛ;
- вводит УНП, который относится к ИП;
- получает confirm;
- соглашается на switch;
- форма переключается на ИП;
- имя и адрес применяются корректно;
- `ЗАО` не остается;
- после save + reopen всё остается ИП, а не откатывается.

Это должен быть отдельный DoD-кейс.

### 5. Parser proof лучше сделать не “тестовый debug-path”, а **доказуемый output**

Фраза про `parser-proof helper/тестовый debug-path` звучит расплывчато. Лучше так:

- показать фактический результат функции `parseGrpAddress(...)` для строки  
`г. Минск, ул. Панфилова, д.2, оф.49л`
- ожидаемый output:
  - `street = Панфилова`
  - `house = 2`
  - `apartment = 49л`

Без отдельного debug-UI, если он не нужен продукту.

### 6. Отдельно зафиксировать, что **ИП не имеет org form в форме ИП**

Это у тебя подразумевается, но лучше записать явно:

- в `EntrepreneurDetailsForm` не применять `org_form`;
- `entity_kind=entrepreneur` ведет только к:
  - `ent_name = clean_name || name`
  - apply structured address
  - safe enrichment
- никакая форма собственности не должна искусственно добавляться.

### 7. Добавить одну строку про `Другое`

Этот PATCH в основном про `house + entity_kind`, но чтобы не было вопросов, лучше явно написать:

- verify/save-reopen для manual flow `Другое` в этот PATCH не входит повторно, если уже закрыт предыдущим патчем;
- либо, если не закрыт, пометить отдельным open item.

Сейчас иначе кажется, что этот кусок ТЗ потерялся.

---

## Итог

**План хороший и по сути правильный**, но я бы не отправлял его без этих 3 ключевых добавок:

1. явный `pendingGrpAutofillPayload` / handoff state для switch ЮЛ → ИП;
2. явная очистка legacy/state ЮЛ при switch;
3. отдельный verify-кейс на switch-flow ЮЛ → ИП.

Готовая формулировка для отправки:

```text
Да, согласен, с учетом правок:

1. Добавь page-level handoff state для switch ЮЛ → ИП:
- `pendingGrpAutofillPayload` хранится в `LegalDetails.tsx`;
- после переключения на `entrepreneur` payload один раз применяется в `EntrepreneurDetailsForm`;
- после применения payload очищается.

2. При switch-flow ЮЛ → ИП явно очищать legacy/state юрлица:
- `leg_org_form`
- `leg_name`
- `leg_address*`
- autofill state / badges
- address state формы ЮЛ
Иначе старое `ЗАО` может визуально/логически остаться.

3. Зафиксируй, что apply адреса для ЮЛ строится от `emptyAddress() + parsed GRP address`, без merge со старым state до завершения parser/apply.

4. Добавь отдельный VERIFY-кейс:
- пользователь в форме ЮЛ;
- lookup возвращает ИП;
- появляется confirm на switch;
- после подтверждения форма переключается на ИП;
- имя применяется без префикса и без кавычек;
- старое `ЗАО` не остается;
- after save + reopen состояние остается корректным.

5. Parser proof оформить как фактический output функции, а не как абстрактный debug-path:
для строки `г. Минск, ул. Панфилова, д.2, оф.49л` показать:
- street = Панфилова
- house = 2
- apartment = 49л

6. Явно зафиксировать:
- в `EntrepreneurDetailsForm` org form не применяется;
- для ИП используется только `clean_name || name` + structured address + safe enrichment.

7. Если manual flow `Другое` уже закрыт предыдущим PATCH — пометь это явно как out of scope текущего bugfix-пакета, чтобы не терять кусок ТЗ.


План: PATCH 3.2.3 — house apply chain + классификация ИП/ЮЛ + корректный verify
```

## DIAGNOSE

Подтверждены 2 реальные проблемы по коду:

1. `house` теряется не в UI, а в цепочке `parse → apply`.

- `GrpAddressParser` сейчас разбирает адрес по частям после `split(',')` и дом ловит только если часть начинается с `д.` / `дом` (`src/lib/legal-entities/GrpAddressParser.ts:79-83`).
- Для кейсов вида `ул.Короля, 51` есть fallback, но для проблемного сценария нужно явно усилить парсер под варианты `д.2`, `д. 2`, `дом 2`, `д 2`.
- В `LegalEntityDetailsForm.handleGrpConfirm` адрес сначала кладётся как `grpResult.parsed_address`, затем асинхронно заменяется enriched-версией (`src/components/legal-details/LegalEntityDetailsForm.tsx:183-199`). Если `parsed_address.house` пустой, форма может сохранить старый дом из предыдущего состояния/ручного ввода.

2. Для ИП нет явной классификации результата lookup.

- `GrpAutofillService` возвращает `org_form_full`, `clean_name`, `parsed_address`, но не возвращает тип сущности (`src/lib/legal-entities/GrpAutofillService.ts:119-164`).
- `LegalEntityDetailsForm` всегда считает результат юрлицом и применяет `leg_org_form`/`leg_name` без проверки (`src/components/legal-details/LegalEntityDetailsForm.tsx:167-203`).
- Если lookup фактически вернул ИП, старое `ЗАО` не сбрасывается и остаётся в форме.
- В `LegalDetails.tsx` переключение между `legal_entity` и `entrepreneur` живёт на уровне страницы через `selectedType` (`src/pages/settings/LegalDetails.tsx:48-50, 124-130`), но формы сейчас не имеют канала для инициирования такого переключения.

3. Дополнительно подтверждено:

- `safe enrichment` уже реализован в правильную сторону: Google не должен перезаписывать `street/house/city/building/apartment` (`src/lib/address/GrpAddressEnricher.ts:72-89`).
- `StructuredAddressBlock` уже показывает `apartment` и `postal_code` в compact layout (`src/components/shared/StructuredAddressBlock.tsx:48-56`).
- `Другое` уже отрисовано нормальными `Input`, но proof на `save + reopen` в текущем отчёте действительно отсутствует (`src/components/legal-details/OrgFormCombobox.tsx:148-170`).

## DRY RUN

### Что переиспользуем

- `GrpAutofillService` как единый service-layer для классификации и derived-полей.
- `GrpAddressParser` как отдельный parser/adaptor слой для flat-address МНС.
- `GrpAddressEnricher` без изменения архитектуры: только безопасное дозаполнение пустых полей.
- `PayerTypeSelector` и `selectedType` из `LegalDetails.tsx` для переключения ЮЛ → ИП.
- Существующие address adapters (`LegalEntityAddressAdapter`, `EntrepreneurAddressAdapter`) для canonical + legacy save-path.

### Что меняем

1. `GrpAddressParser`:

- усилить парсинг дома;
- добавить parser-proof helper/тестовый debug-path на уровне сервиса, а не UI;
- гарантировать `house=2` для `г. Минск, ул. Панфилова, д.2, оф.49л`.

2. `GrpAutofillService`:

- добавить `entity_kind: legal_entity | entrepreneur | unknown`;
- классифицировать ИП по `org_form_full === "Индивидуальный предприниматель"` и/или префиксам полного названия;
- расширить autofill-contract без бизнес-логики в формах.

3. `LegalEntityDetailsForm`:

- если lookup вернул `entrepreneur`, не применять silently;
- показать confirm/branch: найден ИП, нужно переключить форму;
- не оставлять старое `ЗАО`;
- apply адреса строить от нового parsed-address, не смешивая с предыдущим адресным state.

4. `LegalDetails.tsx`:

- дать форме callback для переключения типа плательщика из verify-safe flow;
- переключение делать на уровне страницы, а не внутри формы.

5. `EntrepreneurDetailsForm`:

- отдельный verify для ИП-flow;
- `clean_name || name` сохранить;
- не добавлять кавычки и не выделять оргформу искусственно;
- проверить, что safe enrichment адреса работает по тем же правилам.

### Что НЕ входит в PATCH

- без новых таблиц;
- без миграций;
- без новых backend functions;
- без большого рефактора и объединения сценариев ЮЛ/ИП в один универсальный flow;
- только bugfix текущего rollout + verify.

## EXECUTE

### 1. Service-layer: entity kind + parser hardening

Файлы:

- `src/lib/legal-entities/GrpAutofillService.ts`
- `src/lib/legal-entities/GrpAddressParser.ts`

Сделать:

- в `GrpAutofillFields` добавить `entity_kind`;
- в `grpDataToAutofillFields()` вычислять:
  - `entrepreneur`, если найден ИП;
  - `legal_entity`, если есть оргформа юрлица;
  - `unknown` — fallback.
- усилить `parseGrpAddress()` под варианты:
  - `д.2`
  - `д. 2`
  - `дом 2`
  - `д 2`
  - standalone numeric after street
- зафиксировать, что parser возвращает `street/house/apartment` как отдельные поля до enrichment.

### 2. Legal entity flow: не применять ИП как ЮЛ

Файл:

- `src/components/legal-details/LegalEntityDetailsForm.tsx`

Сделать:

- в `handleGrpConfirm` сначала смотреть `grpResult.entity_kind`;
- если это `entrepreneur`:
  - не применять данные юрлица;
  - открыть confirm-flow: найден ИП, переключить форму на ИП и применить;
- при согласии:
  - вызвать callback наверх;
  - сбросить legacy state юрлица;
  - не оставлять старое `leg_org_form`.
- для адреса при обычном apply использовать новый объект от `grpResult.parsed_address`, а не смешивать с предыдущим адресом формы.

### 3. Page-level orchestration: переключение ЮЛ → ИП

Файл:

- `src/pages/settings/LegalDetails.tsx`

Сделать:

- добавить callback в `LegalEntityDetailsForm` для request-switch на `entrepreneur`;
- при подтверждении переключать `selectedType` на `entrepreneur`;
- передавать в форму ИП нормализованные значения lookup, не размазывая бизнес-логику по UI.

### 4. Entrepreneur verify-safe flow

Файл:

- `src/components/legal-details/EntrepreneurDetailsForm.tsx`

Сделать:

- оставить `ent_name = clean_name || name`;
- явно не использовать org form для ИП;
- проверить, что адрес ИП идёт через тот же `parsed_address → safe enrichment → adapter save`;
- не допускать кавычек/префикса `Индивидуальный предприниматель` в `ent_name`.

### 5. VERIFY / отчёт переписать по факту

Новый verify-пакет должен включать только реальные пруфы:

1. Юрлицо:

- before confirm
- after confirm
- after save
- after reopen

Доказать:

- `ул. Панфилова`
- `дом 2`
- `49л`
не теряются и не подменяются.

2. ИП:

- before confirm
- after confirm
- after save
- after reopen

Доказать:

- имя без префикса;
- без кавычек;
- старое `ЗАО` не остаётся;
- если lookup найден как ИП из формы ЮЛ — есть корректный switch-flow, а не silent apply.

3. Parser proof:

- отдельно показать результат парсинга строки
`г. Минск, ул. Панфилова, д.2, оф.49л`
в structured-поля:
  - street
  - house
  - apartment

4. Canonical / legacy proof:

- после save + reopen structured JSONB согласован с полями формы;
- legacy string пересчитана из canonical корректно.

## DoD

- `GrpAddressParser` стабильно извлекает `house=2` для адресов МНС с вариантами `д.2 / д. 2 / дом 2 / д 2`;
- apply адреса больше не смешивает новый GRP house с прошлым state формы;
- если GRP уже дал `house`, Google не имеет права его перезаписать;
- `GrpAutofillService` возвращает `entity_kind`;
- при lookup ИП из формы ЮЛ старое `ЗАО` не остаётся;
- ИП-flow либо корректно переключает пользователя на форму ИП, либо явно блокирует silent apply;
- `ent_name` сохраняется как `clean_name || name`, без префикса и без кавычек;
- verify включает `after confirm`, `after save`, `after reopen`;
- текущий этап не помечается как closed, пока эти 2 бага не подтверждены фактом.