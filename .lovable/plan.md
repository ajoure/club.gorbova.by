## да, согласен, с учетом правок:

1. `data-lovable-slot-group` **должен быть реальным контейнером, а не пустым sibling-div.**  
Bridge вызывает `group.querySelectorAll(...)`, поэтому внутри группы должны находиться:
  - 5 fixed wrappers соответствующего тарифа;
  - `data-lovable-slot-extra`;
  - 5 variant templates.
  Допустимы два варианта:
  - обернуть эти элементы контейнером `display:contents`;
  - поставить `data-lovable-slot-group` на уже существующий общий DOM-контейнер карточки.
  Пустой `<div>` перед кнопками не создаст scope, и группа получит ноль wrappers/templates.
2. **Три lead-кнопки нельзя снова привязывать к** `tariff:buh`**.**  
Старый `data-tariff-key="buh"` у всех трёх lead-кнопок — известный дефект legacy HTML. Сопоставить их по заголовку карточки:
  ```text
  Бухгалтер          → buh
  Главный бухгалтер  → gl_buh
  Бизнес-леди        → biz-l

  ```
  В grouped-layout каждая lead-кнопка становится пятой fixed position своей группы:
  ```html
  data-lovable-offer-wrapper
  data-lovable-slot-position="5"
  data-lovable-position-variant="lead"

  ```
  `data-lovable-slot="tariff:buh|offer:lead"` на этих wrappers не нужен.
3. **Frozen map должен охватывать 15 fixed wrappers, а не делить их на 12 + 3 legacy slots.**  
После cutover каждая карточка содержит пять позиций:
  ```text
  primary
  legal_entity
  installment
  installment
  lead

  ```
  Конкретное количество installment-позиций и их порядок фиксируется по текущей карточке. Со всех 15 wrappers удалить `data-lovable-action` и `data-tariff-key`.
4. **Не выполнять замену только по тегу** `<a>`**.**  
Frozen migration map должен содержать для каждой позиции:
  ```text
  tariff key
  card heading
  outer t396__elem id/class
  old action
  old tariff_key
  expected current label
  slot position
  position variant

  ```
  Патчить внешний `.t396__elem` wrapper и точный label-узел. Каждая запись должна совпасть ровно один раз.
5. **Исправить ожидаемые after-счётчики.**  
Templates также должны содержать `data-lovable-offer-label`, иначе clone не получит безопасный label-host. Поэтому в сохранённом HTML ожидается:
  ```text
  data-lovable-offer-wrapper        = 15
  data-lovable-position-variant      = 15
  data-lovable-slot-group            = 3
  data-lovable-slot-extra            = 3
  data-lovable-slot-template         = 15
  data-lovable-offer-label           = 30
                                        15 fixed + 15 templates

  ```
  Runtime clones в эти stored-HTML счётчики не входят.
6. **Template не должен участвовать в поиске fixed wrappers.**  
Корневой template-div:
  ```html
  <div hidden data-lovable-slot-template="primary">

  ```
  не должен иметь `data-lovable-offer-wrapper`, `data-lovable-slot-position` или вложенного узла с этими атрибутами. Bridge добавляет `data-lovable-offer-wrapper` только созданному clone.
  До deploy добавить:
  ```js
  clone.removeAttribute('hidden');
  clone.style.display = '';

  ```
  На исходном template не использовать дополнительный inline `display:none`; только `hidden`.
7. **Проверить фактическую работу extra-container внутри Tilda artboard до SQL-write.**  
Normal-flow элемент внутри фиксированного absolute Tilda-artboard может не увеличивать высоту страницы и перекрыть следующий блок. До cutover собрать временный локальный DOM-fixture и доказать:
  ```text
  0 extra → высота не меняется
  1 extra → карточка/artboard увеличивается
  max extra → нет перекрытия «Для кого?» и следующей секции

  ```
  Если artboard не растёт, extra-container нужно размещать в реально участвующей в потоке области либо bridge должен увеличивать высоту artboard/card backgrounds. Одного `position:relative` недостаточно.
8. `sort_order` **пока не является глобальным при variant-locked positions.**  
Текущий алгоритм меняет порядок только среди offers, которым подходят одинаковые variants. Изменение порядка между `primary`, `legal_entity`, `installment` и `lead` визуально не переставит кнопки.
  До завершения задачи нужно либо:
  - заменить внутреннее оформление fixed wrapper из соответствующего variant-template, сохраняя только координаты позиции;
  - либо явно зафиксировать, что `sort_order` действует только внутри одного variant, и согласовать это как ограничение.
  Исходное требование предполагает глобальное изменение порядка, поэтому предпочтителен первый вариант.
9. **Не фиксировать DoD как “12 active / 3 inactive”.**  
Runtime-счётчики должны вычисляться из актуального frozen manifest:
  ```text
  active offers
  inactive fixed positions
  overflow offers
  missing templates

  ```
  Один offer не должен теряться только потому, что для тарифа подготовлено пять fixed positions. Все активные offers обязаны быть представлены либо fixed wrapper, либо extra clone.
10. **Smoke-тест должен определять диалог по данным offer, а не по visual variant.**  
`site_button_variant` отвечает только за оформление. Ожидаемый dialog определяется через:
  ```text
  offer_type
  payment_method
  invoice-only metadata
  bank-installment metadata

  ```
  Для каждого клика:
  - закрыть предыдущий dialog;
  - проверить точный `offer_id`;
  - подтвердить правильный canonical dialog;
  - подтвердить отсутствие legacy resolver.
11. **Inactive wrapper не нужно физически кликать обычным Playwright click.**  
Для него проверить:
  ```text
  data-lovable-slot-inactive="1"
  display:none
  offer_id отсутствует
  pointer interaction невозможен
  dialog state не изменился

  ```
  Обычный Playwright click по `display:none` завершится ошибкой и не докажет bridge refuse.
12. **Visual baseline снять до HTML-write.**  
После deploy bridge v8, но до SQL UPDATE сохранить screenshots:
  ```text
  1440
  960
  375

  ```
  Затем сравнить:
  - текущую конфигурацию before/after;
  - 0 extra;
  - 1 extra;
  - максимальное число extra offers.
  Общий threshold 1% недостаточен сам по себе: вне action-групп diff должен быть практически нулевым; action-зоны проверяются отдельно.
13. **Live-config proof дополнить первоначальным scope.**  
Помимо rename и disable обязательно проверить:
  ```text
  sort_order
  создание нового активного offer
  появление extra clone
  удаление временного offer
  полное восстановление исходного snapshot

  ```
  Восстановление выполнять через `finally`, чтобы тестовые данные не остались при падении Playwright.
14. **Production proof обязателен.**  
`localhost:8080/cb` можно использовать для предварительного E2E, но перед HTML-write нужно подтвердить bridge v8 на опубликованной странице, а после cutover выполнить smoke на фактическом публичном `/cb`.
15. **Усилить SQL preflight.**  
Помимо checksum проверить:
  ```sql
  jsonb_array_length(blocks) = 1
  blocks->0->>'type' = 'html'
  blocks->0->>'id' = '<expected block id>'
  page product_id = PRD-000039 UUID

  ```
  UPDATE обязан вернуть ровно одну строку. Rollback должен иметь guard по after-checksum, чтобы случайно не затереть последующие изменения.
16. **Отчёт должен содержать не только 15 fixed wrappers, но и полный runtime manifest:**  
для каждого активного offer:
  ```text
  tariff_id
  offer_id
  slot_role
  variant
  sort_order
  rendered_as=fixed|extra
  position
  dialog type
  click result

  ```

После этих исправлений план можно выполнять без дополнительных промежуточных согласований.

&nbsp;

Шаг 3 — HTML cutover /cb на dynamic slots

Цель: заменить 12 существующих Tilda-кнопок PRD-000039 на разметку слотов, добавить extra-контейнеры и variant-шаблоны, доказать отсутствие визуальной регрессии и работоспособность bridge v8.

### 0. Порядок деплоя (жёсткий)

1. Опубликовать текущий frontend (bridge v8 + parent-валидация + admin UI — уже в коде, не задеплоены).
2. Только после успешного publish и smoke-проверки `lovable-bridge-ready v8` — писать HTML в БД.

Никакого HTML-write до deploy: старый bridge не поймёт новую разметку, кнопки станут неоткликаемыми.

### 1. Snapshot и checksum до правки

- Прочитать `site_pages.blocks[0].content.code` для `id=d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656` через `supabase--read_query`.
- Сохранить в `/mnt/documents/cb_phase_b/cb_before.html`.
- Посчитать `sha256` и `md5`, длину в байтах, число вхождений:
  - `data-lovable-action` (ожидается 15),
  - `data-tariff-key="buh"` / `"gl_buh"` / `"biz-l"`,
  - `data-lovable-slot` (ожидается 0),
  - `data-lovable-slot-group` (0),
  - `data-lovable-slot-template` (0),
  - `data-lovable-slot-extra` (0).
- Записать снимок в `/mnt/documents/cb_phase_b/cb_before.manifest.json`.

### 2. Frozen migration map

12 фиксированных замен `<a class="tn-atom" data-lovable-action=X data-tariff-key=Y>` → слот-разметка (см. §6 discovery). Каждая пара `(action, tariff_key)` встречается ровно один раз — считаем before/after и падаем при несовпадении.

Отдельно 3 `open-lead|buh` (все на inactive lead buh, скрыты manifest'ом) — помечаем `data-lovable-slot="tariff:buh|offer:lead"` без изменения tariff_key (bridge их скроет; parent валидирует, что offer не в manifest → отклонит клик безопасно). Финальный визуальный аудит трёх lead-кнопок остаётся отдельной задачей после cutover, миграцию не блокирует.

### 3. Разметка на карточку тарифа

Для каждого из 3 тарифов (`buh`, `gl_buh`, `biz-l`) добавить:

- **обёртку группы** — новый нулевой invisible-div сразу перед первой кнопкой карточки:
  ```html
  <div data-lovable-slot-group="tariff:<key>" style="display:contents"></div>
  ```
  (span-нейтральный: `display:contents` не создаёт box, Tilda absolute-раскладка не сдвигается; bridge использует `querySelectorAll` от `document`, но группа даёт scope для template lookup — см. §5).

Замена 4 fixed-кнопок (payment_card / payment_invoice / installment_* / installment_bank) на каждой карточке:

```html
<div class="t396__elem tn-elem …" data-lovable-offer-wrapper
     data-lovable-slot-position="N"
     data-lovable-position-variant="<variant>"
     …absolute style…>
  <a class="tn-atom" href="#">
    <div class="tn-atom__button-content">
      <span class="tn-atom__button-text" data-lovable-offer-label>…текущий label…</span>
    </div>
    <span class="tn-atom__button-border"></span>
  </a>
</div>
```

Правила:

- Атрибуты `data-lovable-action` и `data-tariff-key` **удаляются** у мигрированных кнопок.
- `href="#"` (был `#`). Клик перехватывается bridge через wrapper (v8 anchor interceptor уже пропускает `data-lovable-offer-wrapper`).
- Label-нода — единственный узел, куда bridge пишет `textContent`; Tilda `.tn-atom__button-border` не трогается.
- `data-lovable-slot-position` — 1..4 в исходном визуальном порядке карточки.
- `data-lovable-position-variant` — variant, под который позиция изначально стилизована.

### 4. Extra-контейнер

В конец каждой карточки, **внутри неё**, после последней absolute-кнопки добавить normal-flow контейнер:

```html
<div data-lovable-slot-extra="tariff:<key>"
     class="lovable-cb-extra"
     style="position:relative;display:flex;flex-direction:column;gap:12px;margin-top:24px;"></div>
```

Плюс CSS-блок (один раз в самое начало HTML, в `<style>`):

```css
.lovable-cb-extra:empty { display: none !important; }
.lovable-cb-extra > [data-lovable-slot-clone] { position: relative; }
```

Пустой контейнер невидим и не сдвигает соседние absolute-элементы.

### 5. Скрытые variant templates (5 × 3 = 15)

Внутри каждой группы (в конце карточки, после extra-контейнера) добавить 5 hidden templates по одному на variant:

```html
<template data-lovable-slot-template="primary">…</template>
<template data-lovable-slot-template="outline">…</template>
<template data-lovable-slot-template="installment">…</template>
<template data-lovable-slot-template="legal_entity">…</template>
<template data-lovable-slot-template="lead">…</template>
```

Внутри `<template>` — normal-flow клон Tilda-кнопки соответствующего variant без absolute (использует базовые классы `.tn-atom`, `.tn-atom__button-*`). Bridge клонирует `.content` при overflow.

**Проблема:** bridge использует `tpl.cloneNode(true)` и `extra.appendChild(clone)` — а `<template>.cloneNode(true)` возвращает сам template, не его content. Нужно либо:

- переключить bridge на `tpl.content.firstElementChild.cloneNode(true)`, либо
- использовать вместо `<template>` обычный `<div hidden data-lovable-slot-template=…>`, как это уже работает в текущем bridge.

Выберу второй путь (без правки уже отревьюенного bridge v8): templates — это `<div hidden>`. Атрибут `hidden` убирается при клонировании (`clone.removeAttribute('hidden')` не нужен, т.к. bridge выставляет `clone.style.display = ''`, а `hidden` работает через display — надо `clone.removeAttribute('hidden')`).

→ Уточнение к bridge: добавить `clone.removeAttribute('hidden')` рядом с `clone.style.display = ''`. Это одна строка, полностью в рамках Шага 2.

### 6. Атомарная запись HTML

Одна SQL-миграция:

```sql
UPDATE public.site_pages
SET blocks = jsonb_set(blocks, '{0,content,code}', to_jsonb($NEW_HTML::text))
WHERE id = 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656'
  AND md5(blocks->0->'content'->>'code') = 'bd5e0e3213b3e55dcf8d023231ffc7f5';
```

Fail-closed: если before-checksum не совпал (HTML успели поправить между snapshot и миграцией) — 0 rows updated, вручную rebase.

### 7. After-verification

Сразу после успешного UPDATE прочитать код обратно и проверить:

- `data-lovable-action` встречается 3 раза (только оставшиеся `open-lead|buh` слоты — они помечены slot'ом, но `data-lovable-action` мы у них сохраняем? Нет — тоже удаляем. Итого **0** мигрированных). Ожидается: 0 `data-lovable-action`, 0 `data-tariff-key`.
- `data-lovable-slot-group` == 3.
- `data-lovable-offer-wrapper` == 15 (12 fixed + 3 lead-buh).
- `data-lovable-offer-label` == 15.
- `data-lovable-position-variant` == 15.
- `data-lovable-slot-extra` == 3.
- `data-lovable-slot-template` == 15 (5 × 3).
- Никакая мигрированная позиция не содержит одновременно `data-lovable-slot` и `data-lovable-action` (mutual exclusion).

Любое отклонение → откат: `UPDATE … SET blocks = $BEFORE_JSONB`.

### 8. Smoke-тест кликов (Playwright)

Скрипт `/tmp/browser/cb_cutover/`:

1. Открыть `http://localhost:8080/cb`, дождаться iframe и `lovable-bridge-ready` в console.
2. Полное сканирование `data-lovable-offer-wrapper` внутри iframe: у каждого — непустой `data-lovable-offer-id` (UUID), `data-lovable-offer-tariff-id` (UUID), `data-lovable-offer-slot-role`, `data-lovable-offer-variant`.
3. Скрытые wrapper'ы: у неактивных offer'ов установлен `data-lovable-slot-inactive="1"` и `display:none` (кейс `buh`/`installment_3` и трёх `lead-buh`).
4. Клик по каждому активному wrapper → в parent DevTools console нет warning `[site-action] open-slot: …`; открывается ожидаемый диалог (PaymentDialog / InvoiceCheckoutDialog / LeadRequestDialog в зависимости от variant).
5. Клик по inactive wrapper → диалог не открывается, warnings нет (bridge preventDefault + return).

### 9. Visual regression

- Screenshot до/после для трёх viewport: 1440, 960, 375.
- Diff по каждому screenshot (Pillow, threshold 1% пикселей).
- Ожидание: 0 % изменений на пустых extra-контейнерах и wrapper-обёртках (координаты, размер, borders сохранены).
- Полученные PNG складывать в `/mnt/documents/cb_phase_b/screenshots/`.

### 10. Live-config proof

Использовать admin UI:

1. Изменить `button_label` для `payment_card | biz-l` на «Новый текст TEST».
2. Ждать ≤ 30 с → label в iframe должен обновиться без reload.
3. Выключить `payment_invoice | gl_buh` (`is_active=false`) → wrapper скрывается.
4. Вернуть исходные значения.

Скриншоты каждого шага, приложить к отчёту.

### 11. Отчёт

`/mnt/documents/cb_phase_b/cutover_report.md`:

- before/after checksums,
- счётчики маркеров,
- список 15 wrapper'ов с offer_id/tariff_id/role/variant,
- ссылки на visual-diff screenshots,
- лог smoke-теста,
- лог live-config теста.

### DoD

- Bridge v8 задеплоен и подтверждён handshake'ом.
- HTML переписан атомарно с before-checksum guard.
- After-verification зелёная по всем 8 счётчикам.
- Playwright smoke: 12 активных wrapper'ов → корректный диалог; 3 inactive → тихий refuse.
- Visual diff ≤ 1 % на трёх viewport.
- Live-config proof: rename ≤ 30 с, toggle скрывает wrapper.
- Отчёт сохранён под `/mnt/documents/cb_phase_b/`.

Готовность к rollback: SQL-UPDATE обратно на `$BEFORE_JSONB` — одна миграция, безопасно в любой момент до/после cutover.