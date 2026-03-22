да, согласен, с учетом правок:

1. В `StructuredAddressBlock` делай не просто rollback label-copy, а **полный локальный rollback всего address-label interaction**:
  - убрать `onClick`
  - убрать `title`
  - убрать `cursor-pointer` и hover-стили
  - убрать любые вызовы `toast.success("ID скопирован")`
  - убрать зависимость address-label rendering от `fieldIds` в UI-поведении  
  `fieldIds` можно оставить только как данные, без интерактива.
2. Для suggestion item используй **один основной путь выбора**:
  - `onPointerDown` как основной
  - внутри сразу `preventDefault()`, `stopPropagation()`, `isSelectingRef.current = true`, прямой `handleSelect(prediction)`
  - `onClick` для выбора адреса убрать, чтобы не было второго конкурирующего сценария.
3. После `handleSelect` обязателен симметричный reset selection-guard:
  - `isSelectingRef.current = false` в success-path
  - `isSelectingRef.current = false` в error/finally-path  
  Иначе можно починить один клик и сломать следующий.
4. Отдельно проверь, что blur/close логика не убивает pointer-path:
  - dropdown не закрывается раньше `handleSelect`
  - `clearPredictions()` не вызывается до завершения выбора
  - после выбора dropdown закрывается уже штатно, а не “раньше времени”.
5. В proof для `/ai` и `/settings/legal-details` добавь **один и тот же адрес** и покажи два отдельных сценария:
  - mouse select
  - keyboard select  
  И по каждому явно зафиксируй:
  - toast `ID скопирован` не появляется
  - поля реально заполнены
  - save проходит.
6. В data-proof покажи не только `address_structured`, но и что в legacy-поля реально ушли:
  - street
  - house
  - building
  - apartment
  - city
  - region
  - postal_code
  - country  
  иначе можно сохранить JSONB, но потерять совместимость текущих форм/preview.
7. Repo-wide coverage оформи таблицей по всем consumer-путям `StructuredAddressBlock`:
  - экран
  - есть ли `fieldIds`
  - проверен ли mouse path
  - проверен ли keyboard path
  - затронут / не затронут hotfix  
  Без этого нельзя считать shared-fix доказанным.
8. В regression-proof отдельно добавь:
  - ручной ввод без выбора suggestion не ломается
  - lookup по УНП + `GrpConfirmDialog` по-прежнему работает
  - preview для Минска и не-Минска не регресснул после hotfix.
9. До закрытия hotfix не переходить к PATCH 6.
10. &nbsp;
11. &nbsp;
12. PATCH 5R++ HOTFIX — rollback copy inside StructuredAddressBlock + select on pointerdown/mousedown

## Что подтверждено по факту

- Баг в mouse path реально не закрыт: в session replay после выбора address suggestion снова появляется toast `ID скопирован`.
- Клавиатурный path уже живой, значит `handleSelect()` и сам autocomplete в целом работают.
- Проблема остаётся именно в mouse interaction chain.
- `StructuredAddressBlock` сейчас всё ещё смешивает:
  - input/autocomplete interaction
  - copy-by-label через `fieldIds`
- Это подтверждается кодом:
  - внутри `StructuredAddressBlock.tsx` label всё ещё имеет `onClick`, `title`, `cursor-pointer`, `toast.success("ID скопирован")`
  - suggestions по mouse path всё ещё выбираются через `onClick`, а не прямым select на `pointerdown/mousedown`
- Repo-wide consumers `StructuredAddressBlock`:
  - `OrganizationDetailsForm` — передаёт `fieldIds`, затронут
  - `IndividualDetailsForm` — передаёт `fieldIds`, затронут
  - `LegalEntityDetailsForm` — без `fieldIds`, проверить, но rollback безопасен
  - `EntrepreneurDetailsForm` — без `fieldIds`, проверить, но rollback безопасен
  - `AdminExecutors` — без `fieldIds`, проверить, но rollback безопасен

## Что делаем

### 1) Обязательный rollback только внутри StructuredAddressBlock

Файл: `src/components/shared/StructuredAddressBlock.tsx`

У всех label внутри address block:

- убрать `onClick`
- убрать copy handler
- убрать `title` с `FLD-...`
- убрать `cursor-pointer` / hover-стили
- вернуть обычные статичные label

Важно:

- `FieldLabelWithId` в остальных частях платформы не трогать
- rollback только локально в address block

### 2) Перенести выбор suggestion на раннюю фазу события

В `StructuredAddressBlock.tsx` для suggestion item:

- делать выбор на `onPointerDown` (или минимум `onMouseDown`)
- внутри:
  - `preventDefault()`
  - `stopPropagation()`
  - прямой вызов `handleSelect(prediction)`
- не полагаться на последующий `click` для выбора

Цель:

- адрес выбирается в момент нажатия на suggestion, до blur / close / unmount / протекания клика вниз

### 3) Не трогать display-слой

Сейчас не менять:

- formatter
- preview/view shell
- GRP lookup
- PATCH 6

## Порядок выполнения

### Этап A — минимальный hotfix

1. Убрать copy-by-label из `StructuredAddressBlock`
2. Перенести selection suggestion на `pointerdown/mousedown`
3. Сохранить keyboard path (`ArrowDown + Enter`) без изменений

### Этап B — proof в реальном UI

Один и тот же кейс, один и тот же адрес, в двух путях:

#### `/ai`

Показать:

- ввод адреса
- появление подсказок
- клик мышью по suggestion
- toast `ID скопирован` не появляется
- поля заполняются:
  - улица
  - дом
  - корпус
  - помещение
  - город
  - область
  - индекс
  - страна

#### `/settings/legal-details`

Тот же сценарий 1:1:

- ввод
- подсказки
- mouse select
- поля заполнены
- без toast

#### Keyboard path

Отдельно:

- `ArrowDown + Enter`
- адрес по-прежнему выбирается корректно

### Этап C — data proof

Для одного кейса:

- `address_structured` после save
- legacy-поля после save (`street/house/building/apartment/city/region/postal_code/...`)
- повторное открытие записи
- preview показывает корректный адрес

### Этап D — regression-proof

Подтвердить, что не сломаны:

- ручной ввод адреса без выбора подсказки
- lookup по УНП + apply через `GrpConfirmDialog`
- сохранение legacy-полей из `address_structured`
- preview/view formatter для Минска и не-Минска

## Файлы, которые с высокой вероятностью войдут

- `src/components/shared/StructuredAddressBlock.tsx`

Возможны только proof-проверки по:

- `src/components/legal-details/OrganizationDetailsForm.tsx`
- `src/components/legal-details/IndividualDetailsForm.tsx`
- `src/components/legal-details/LegalEntityDetailsForm.tsx`
- `src/components/legal-details/EntrepreneurDetailsForm.tsx`
- `src/pages/admin/AdminExecutors.tsx`

## DoD

- в `StructuredAddressBlock` больше нет copy-by-label
- при выборе suggestion не появляется toast `ID скопирован`
- mouse path стабильно выбирает именно адрес
- keyboard path продолжает работать
- все доступные адресные сегменты подставляются в форму
- один и тот же сценарий подтверждён в `/ai` и `/settings/legal-details`
- save пишет корректный `address_structured` и legacy-поля
- preview после save остаётся корректным
- PATCH 6 не начинаем до закрытия этого hotfix