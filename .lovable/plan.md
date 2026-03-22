да, согласен, с учетом правок:

1. В блоке **Branch B** явно зафиксировать приоритет:
  - сначала **локальный фикс в AI-shell /** `EntityRecordSheet`,
  - **глобально** `sheet.tsx` **не трогать**, пока не будет доказано, что локального guard недостаточно.
2. В блоке **Диагностика** добавить обязательный trace не только событий address block, но и **sheet-level outside interaction**:
  - `onPointerDownOutside`
  - `onInteractOutside`
  - `onFocusOutside`
  - закрытие/перерисовка sheet body  
  Иначе не будет окончательно доказано, что ломает именно shell.
3. Временную инструментализацию зафиксировать как **DEV-only**:
  - без постоянных `console.log`,
  - после proof обязательно удалить,
  - закрытие патча без cleanup instrumentation запрещено.
4. В proof-пакете отдельно зафиксировать:
  - `/settings` = **control case**,
  - `/ai` = **broken/fixed case**,
  - один и тот же адрес,
  - один и тот же сценарий мышью,
  - **одинаковый consumer form**, но разный shell.  
  Это нужно оформить как отдельный deliverable, а не просто как часть описания.
5. В блоке **Branch A** уточнить:
  - shared `StructuredAddressBlock` правим **только если trace покажет**, что цепочка рвется **до** `handleAddressChange`,
  - если `handleSelect` и `onChange` уже доходят до формы, shared block не трогаем.
6. Для **highlight readability** зафиксировать как отдельный независимый mini-patch внутри hotfix:
  - сначала audit shared usage,
  - потом единый token-level fix,
  - proof минимум на 3 компонентах:
    - address dropdown,
    - select,
    - ещё один shared list/menu.
7. В DoD добавить явный пункт:
  - **в** `/ai` **mouse-path должен работать без каких-либо специальных workaround пользователя**,
  - то есть без Enter, без повторного клика, без необходимости сначала наводить клавиатурой.
8. В DoD добавить ещё один обязательный пункт:
  - после фикса **не должно быть расхождения между** `/settings` **и** `/ai` **по заполнению адресных сегментов** на одном и том же адресе.
9. В STOP GUARD дополнительно зафиксировать:
  - не менять `OrganizationDetailsForm` бизнес-логику,
  - не менять mapping legacy fields,
  - не менять save contract, если trace не покажет проблему именно там.
10. Финально добавить правило приемки:

- если подрядчик пишет “fixed”, но не даёт **runtime-proof именно mouse-path в** `/ai`, патч считается **не закрытым**.
- &nbsp;
- PATCH 5R++ HOTFIX — не “копировать функцию”, а локально починить AI-shell, потому что код формы уже один и тот же.

1. FACT PROOF: в `/settings/legal-details` и в `/ai` уже используется один и тот же код

- `OrganizationDetailsForm` импортируется и в settings, и в AI.
- Внутри него в обоих путях используется один и тот же `StructuredAddressBlock`.
- Значит переносить “рабочую функцию из настроек” некуда: shared address logic уже общая.
- Разница не в функции, а в consumer-context:
  - `/settings` = обычная страница
  - `/ai` = тот же form внутри `EntityRecordSheet` → `SheetContent` (Dialog/portal/scroll shell)

2. Primary suspect #1

- Баг почти наверняка в AI-оболочке:
  - `EntityRecordSheet`
  - `Sheet` / Radix Dialog
  - portal dropdown из `StructuredAddressBlock`
  - outside pointer handling / focus trap / scrollable body
- Shared address-flow не считаю тотально сломанным, потому что settings сейчас выглядит как control case.

3. Диагностика перед фиксом

Добавлю временный runtime trace только для hotfix:

- `StructuredAddressBlock`
- `OrganizationDetailsForm`
- `EntityRecordSheet` / sheet interaction point

Нужно снять порядок событий в `/ai` и сравнить с `/settings`:

- `pointerdown` on suggestion
- `handleSelect START`
- `fetchPlaceDetails done`
- `onChange(merged)`
- `handleAddressChange`
- `document mousedown close`
- `scroll close`
- `sheet outside handler fired / not fired`

Цель: доказать, где именно обрывается mouse-path в `/ai`.

4. Ветки исправления

Branch B — приоритетная:

- если trace покажет, что settings живой, а AI ломает outside/sheet-context,
- делаю локальный guard именно в AI-shell:
  - помечаю dropdown marker-атрибутом, например `data-address-dropdown`
  - в AI sheet path игнорирую outside-interaction по этому marker
  - не трогаю глобально весь `sheet.tsx`, пока локальный фикс не окажется недостаточным

Branch A — только если trace покажет реальную проблему в shared block:

- правка `StructuredAddressBlock` event-chain
- только там, где selection реально теряется до `onChange`

5. STOP GUARD

До закрытия hotfix не трогаю:

- formatter
- Minsk rules
- GRP parser/enricher
- preview shell
- PATCH 6

6. Highlight readability — отдельная независимая подзадача

- сначала audit всех shared usage `bg-accent` / `text-accent-foreground`
- потом единый shared fix только если после аудита реально остаются unreadable места
- proof минимум на:
  - address dropdown
  - select
  - ещё один shared list/menu

7. Proof package

Сравнение на одном и том же адресе и одной и той же последовательности действий мышью:

Control:

- `/settings/legal-details`
- ввод → dropdown → hover → click
- фиксирую, какие поля обновились и какой handler был последним

Broken/fixed:

- `/ai`
- тот же сценарий
- фиксирую, в какой точке раньше рвался chain и что именно устранил фикс

Обязательно:

- mouse select в `/ai`
- keyboard select в `/ai`
- no toast `ID скопирован`
- после mouse select реально заполнены:
  - street
  - house
  - building
  - apartment
  - city
  - region
  - postal_code
  - country
- save пишет корректные `address_structured` и legacy fields
- instrumentation после proof удалена

8. DoD

- `/settings/legal-details`: mouse select ✅, keyboard select ✅
- `/ai`: mouse select ✅, keyboard select ✅
- trace показывает, что в `/ai` selection доходит до `handleSelect` и `onChange`
- объяснено, почему settings работает, а AI нет: тот же address block, но другая UI-оболочка и event-chain
- если добавлен локальный shell guard, доказано, что именно он устранил расхождение
- `address_structured` и legacy fields корректны после save
- highlight readable в shared dropdown/list patterns
- formatter/view/lookup не регресснули
- без runtime-proof именно для `/ai` mouse path патч не считается закрытым