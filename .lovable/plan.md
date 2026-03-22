да, согласен, с учетом правок:

1. В Этапе A не фиксируйте root cause заранее как “именно copy-ID”. Нужно доказать фактически, где ломается interaction-chain:
  - `pointerdown/mousedown` по suggestion
  - `blur` input
  - `click` по suggestion
  - `onSelect`
  - `onChange(merged)`
  - copy-handler label  
  И только после этого писать точную причину.
2. В proof обязательно показать **один и тот же кейс** в двух путях:
  - `/ai`
  - `/settings/legal-details`  
  с одинаковым адресом и одинаковым ожидаемым результатом.
3. Добавьте обязательный proof не только для mouse path, но и для:
  - keyboard path (`ArrowDown` + `Enter`)
  - blur после выбора  
  Иначе можно починить только клик мышью.
4. В regression-proof зафиксируйте, что после hotfix не ломаются:
  - ручной ввод адреса без выбора подсказки
  - lookup по УНП + apply из `GrpConfirmDialog`
  - сохранение legacy-полей из `address_structured`
  - preview/view formatter для Минска и не-Минска
5. В proof-пакете для `/ai` и `/settings/legal-details` показать не только UI, но и данные:
  - `address_structured` до save
  - `address_structured` после save
  - legacy-поля после save (`street/house/building/apartment/city/region/postal_code/...`)  
  чтобы было видно, где именно теряются значения, если теряются.
6. В hotfix явно запретить смешивание display-логики и input-логики:
  - formatter/view shell не трогаем
  - правим только shared interaction/data-flow слоя адреса  
  Иначе снова можно “починить показ”, но оставить сломанным ввод.
7. Repo-wide coverage оформить явно списком consumer-экранов, которые реально используют `StructuredAddressBlock`, и по каждому дать статус:
  - проверен / не затронут
  - требует фикс / не требует фикс
8. В итоговый DoD добавьте отдельный критерий:
  - при выборе suggestion **не появляется toast** `ID скопирован`
  - выбирается именно адрес
  - все доступные адресные сегменты реально подставляются в форму
9. До закрытия этого hotfix PATCH 6 действительно не начинать.
10. &nbsp;
11. PATCH 5R++ HOTFIX — address input flow proof + fix

## Что уже видно по коду

1. Баг локализован не во formatter, а в общем input-shell:

- `StructuredAddressBlock` — единый компонент адреса для всей системы
- именно он отвечает и за dropdown Google, и за кликабельные label с `ID скопирован`

2. Общий риск уже понятен:

- в `StructuredAddressBlock` label поля адреса кликабелен и копирует FLD-ID
- тот же компонент рендерит autocomplete dropdown
- пользовательский симптом “при выборе адреса копируется ID, а адрес не подставляется” совпадает с конфликтом внутри этого shared-компонента, а не с view formatter

3. Важное покрытие по путям:

- `/ai` и `/settings/legal-details` используют один и тот же `OrganizationDetailsForm`
- оба пути используют один и тот же `StructuredAddressBlock`
- значит фикс должен идти в shared address-flow, а не точечно в preview

4. Зоны использования, которые надо проверить:

- `OrganizationDetailsForm`
- `IndividualDetailsForm`
- `EntrepreneurDetailsForm`
- `AdminExecutors`
- при необходимости legacy `LegalEntityDetailsForm`

## Что исправляем

### Уровень 1 — interaction hotfix в `StructuredAddressBlock`

Цель: выбор подсказки всегда должен выбирать адрес, а не запускать copy-ID.

План фикса:

- разобрать конфликт событий между:
  - label click-copy
  - focus/blur input
  - click по dropdown option
- минимально развести эти сценарии внутри `StructuredAddressBlock`
- сохранить стандарт копирования FLD-ID, но убрать возможность его срабатывания вместо выбора address suggestion
- отдельно проверить mouse path и keyboard path:
  - click по suggestion
  - Enter по suggestion
  - blur после выбора

Ожидаемый результат:

- toast `ID скопирован` не появляется при выборе подсказки
- `handleSelect()` реально отрабатывает
- `onChange(merged)` обновляет состояние формы

### Уровень 2 — восстановить полный address-flow, а не только dropdown click

После выбора адреса должны корректно заполниться:

- улица
- дом
- корпус
- помещение / квартира
- город
- область
- индекс
- страна
- район / settlement при наличии

Проверка и при необходимости правки:

- `GooglePlacesAdapter.parseComponents`
- merge в `handleSelect` внутри `StructuredAddressBlock`
- `handleAddressChange` в формах
- адаптеры сохранения `*_AddressAdapter.toLegacyFields(...)`
- чтение/запись `*_address_structured`

## Порядок работ

### Этап A — shared root cause proof

Для одного и того же кейса показать:

1. что `StructuredAddressBlock` получает dropdown predictions
2. что выбор suggestion сейчас уводит в copy-ID / не обновляет address state
3. какие именно поля остаются пустыми после “выбора”
4. какие consumer-пути реально затронуты:

- `/ai`
- `/settings/legal-details`
- остальные места с `StructuredAddressBlock`

### Этап B — минимальный shared hotfix

Файлы-кандидаты:

- `src/components/shared/StructuredAddressBlock.tsx`
- при необходимости `src/components/legal-details/OrganizationDetailsForm.tsx`
- при необходимости `src/components/legal-details/IndividualDetailsForm.tsx`
- при необходимости `src/components/legal-details/FieldLabelWithId.tsx` только если без этого нельзя безопасно развести interaction

Принцип:

- чинить в общем компоненте
- не переписывать formatter/view shell
- не трогать PATCH 6

### Этап C — proof по реальному UI-flow

Обязательный proof-пакет после фикса:

#### 1. `/ai`

Для одного кейса:

- ввод адреса
- появление подсказок
- выбор подсказки
- заполнение всех ячеек
- состояние `address_structured` до save
- состояние `address_structured` после save
- что реально показывается в preview/view

#### 2. `/settings/legal-details`

Тот же тип proof:

- ввод
- подсказки
- выбор
- автозаполнение полей
- save
- повторное открытие
- сохранённый `address_structured`

#### 3. Не-Минск кейс

Проверить, что адрес с областью/районом области:

- корректно подставляется в форму
- корректно сохраняется
- корректно показывается в preview

#### 4. Regression-proof

Подтвердить, что после hotfix не сломаны:

- lookup по УНП
- confirm/apply flow
- preview/view formatter для Минска

## Короткий вывод по дизайну решения

Это должен быть не “ещё один formatter patch”, а именно shared fix адресного interaction-layer.

Сначала закрываем:

- выбор подсказки
- заполнение полей
- сохранение в `address_structured`
- proof в `/ai` и `/settings/legal-details`

Только после этого PATCH 5R++ HOTFIX можно закрывать. PATCH 6 не начинать.

## DoD

- при выборе подсказки не срабатывает `ID скопирован`
- suggestion selection реально подставляет адрес в форму
- поля адреса массово заполняются из выбранного адреса
- сохранение пишет корректный `*_address_structured`
- один и тот же сценарий подтверждён в `/ai` и `/settings/legal-details`
- preview/view после save показывает правильный адрес
- lookup по УНП не регресснул