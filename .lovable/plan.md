да, согласен, с учетом правок:

План правильно закрывает исходное требование: кнопки должны управляться offers нового продукта, а существующий дизайн Tilda — сохраняться. Текущий код действительно выбирает тариф через regex по имени, а для рассрочки берёт первый подходящий `internal_installment`, поэтому переход на точный `offer_id` необходим.

1. **Унифицировать способ хранения** `slot_role`**.** Сейчас план одновременно говорит о `tariff_offers.meta.slot_role` и о «колонке/индексе». Использовать:
  ```text
  tariff_offers.meta.slot_role
  tariff_offers.meta.site_button_variant

  ```
  Отдельную колонку не добавлять. Уникальность обеспечить partial expression index:
  ```sql
  CREATE UNIQUE INDEX ...
  ON public.tariff_offers (
    tariff_id,
    (meta->>'slot_role')
  )
  WHERE nullif(meta->>'slot_role', '') IS NOT NULL;

  ```
2. **Backfill выполнять только по замороженному manifest UUID → role/variant.** Определение по `button_label` допустимо только на этапе read-only discovery для подготовки manifest. В самой миграции запрещены fuzzy-сравнения текстов:
  ```text
  offer_id
  tariff_id
  expected_offer_type
  expected_payment_method
  expected_installment_count
  expected_button_label
  new_slot_role
  new_site_button_variant

  ```
  Любой drift — rollback.
3. **Не переименовывать коды тарифов.** Не менять существующие `tariffs.code` на `cb20_buh` и подобные значения: код может использоваться в заказах, аналитике и других интеграциях. В HTML и manifest использовать точный `tariff_id`:
  ```html
  data-lovable-tariff-id="<uuid>"

  ```
  `tariff.code` можно передавать дополнительно для диагностики, но не использовать как единственный ключ.
4. **Разделить идентичность и внешний вид кнопки:**
  - `offer.id` — единственный runtime-идентификатор действия;
  - `slot_role` — стабильная бизнес-роль;
  - `site_button_variant` — выбор Tilda-шаблона оформления.
  Допустимые варианты должны быть явными:
  ```text
  primary
  outline
  installment
  legal_entity
  lead

  ```
  Стиль нельзя выводить из `button_label`.
5. **Убрать fallback «клонировать первый слот группы».** Он может превратить оплату от юрлица или банковскую рассрочку в кнопку неправильного цвета. В каждой карточке должны существовать скрытые generic templates по визуальному варианту:
  ```html
  data-lovable-button-template="primary"
  data-lovable-button-template="outline"
  data-lovable-button-template="installment"
  data-lovable-button-template="legal_entity"
  data-lovable-button-template="lead"

  ```
  Новый offer с известным `site_button_variant` появляется без изменения HTML. Неизвестный variant — fail-closed, кнопка не рендерится и пишется диагностическая ошибка.
6. **Исправить алгоритм сортировки с учётом Tilda.** `appendChild()` не гарантирует визуального изменения порядка, если кнопки находятся в абсолютно позиционированных Tilda-элементах. Discovery должен установить фактическую DOM/CSS-структуру каждой группы:
  - если кнопки находятся в normal flow — переставлять целые wrapper-узлы;
  - если используются absolute `top/left` — сортированные offers распределять по существующим визуальным позициям, а не менять DOM-порядок;
  - если активных offers больше подготовленных позиций — использовать заранее созданный normal-flow action-container либо fail-closed.
  Нельзя считать `sort_order` реализованным без визуального runtime-proof.
7. **Манипулировать нужно wrapper-кнопкой, а не только** `<a class="tn-atom">`**.** Для каждой позиции отдельно отметить:
  ```html
  data-lovable-offer-wrapper
  data-lovable-offer-label

  ```
  Скрытие, клонирование и перестановка применяются к wrapper. Текст меняется только внутри label-узла. Так сохраняются размеры, фон, SVG, hover и Tilda positioning.
8. **Дополнить цепочку файлов.** `SitePageBySlug` не владеет iframe напрямую: он передаёт blocks в `SitePageRenderer`. Manifest должен пройти по цепочке:
  ```text
  SitePageBySlug
  → SitePageRenderer
  → renderer HTML-блока
  → HtmlIframePreview

  ```
  Добавить optional prop, например `siteActionManifest`, только для нужного HTML-блока `/cb`. Не рассылать manifest глобальным событием всем iframe страницы.
9. **Ввести отдельный handshake.** Не использовать первый `iframe-resize` как признак готовности. Bridge должен отправить:
  ```text
  { type: "lovable-bridge-ready", version: 7, blockId }

  ```
  Parent после этого отправляет manifest. При каждом новом `srcDoc` handshake повторяется.
10. **Защитить канал parent → iframe:**
  - iframe принимает manifest только при `event.source === parent`;
  - проверяет `version`, `page_id`, `block_id`, `product_id`;
  - manifest проходит schema-validation;
  - parent использует `targetOrigin='*'` только потому, что iframe имеет opaque origin без `allow-same-origin`.
  Текущий bridge уже использует sandbox без `allow-same-origin`, поэтому проверка source является обязательной.
11. **Исправить существующий anchor interceptor.** Сейчас он пропускает только anchors с `data-lovable-action`; новый `data-lovable-slot` с `href="#"` будет перехвачен и нейтрализован раньше slot-handler. Добавить:
  ```js
  if (
    a.hasAttribute('data-lovable-action') ||
    a.hasAttribute('data-lovable-slot') ||
    a.hasAttribute('data-lovable-offer-id')
  ) return;

  ```
12. **Manifest должен содержать только активные offers и иметь стабильный порядок:**
  ```text
  sort_order ASC NULLS LAST,
  offer_id ASC

  ```
  Минимальный payload:
  ```text
  tariff_id
  offer_id
  slot_role
  button_label
  site_button_variant
  sort_order

  ```
  `offer_type`, `payment_method`, сумма и прочая платёжная логика остаются в parent и повторно проверяются по `linkedProductData`. Iframe не должен решать, какой dialog открывать.
13. **Handler** `open-slot` **должен повторно валидировать данные в parent:**
  - UUID существует в текущем `linkedProductData`;
  - offer принадлежит переданному `tariff_id`;
  - тариф принадлежит PRD-000039;
  - `is_active !== false`;
  - offer присутствует в последнем manifest.
  Нельзя доверять `offer_id`, присланному из iframe, только потому что UUID синтаксически корректен.
14. **Переиспользовать существующий** `pending → resolved → canonical dialog` **путь.** Текущий компонент уже после выбора ID повторно находит offer внутри product data. Новая ветка должна только установить точный `productId/offerId`; branching диалогов не дублировать.
15. **Fail-closed не должен показывать мёртвые кнопки или вызывать layout flash:**
  - до получения manifest action wrappers получают `visibility:hidden`, `pointer-events:none`, `aria-hidden=true`;
  - после manifest активные показываются;
  - неактивные получают `display:none`;
  - после применения manifest обязательно вызвать resize-sync;
  - при ошибке manifest кнопки остаются недоступными.
16. **React Query invalidation из админки не обновит страницу другого посетителя.** Для обещания «изменяется без релиза и не позднее 30 секунд» нужно выбрать один механизм:
  - `refetchInterval: 30_000` для linked product только на страницах с dynamic slots;
  - либо Supabase Realtime на `tariff_offers`;
  - либо честно определить обновление после refresh страницы.
  Одной invalidation в другом браузере недостаточно.
17. **Все активные offers трёх тарифов должны быть renderable.** Текущий DoD «NULL допустим у offers, для которых нет кнопки» противоречит требованию автоматического появления новых кнопок. После backfill каждый активный публичный offer должен иметь:
  - уникальный `slot_role`;
  - допустимый `site_button_variant`.
  Offer без этих полей не включается в manifest и отображается в админке как ошибка конфигурации.
18. **Admin UI должен иметь серверную и клиентскую валидацию:**
  - `slot_role` обязателен для активного offer PRD-000039;
  - только безопасный формат, например `^[a-z0-9_]{2,64}$`;
  - уникальность внутри тарифа;
  - variant только из allowlist;
  - при конфликте БД возвращает понятную ошибку;
  - изменение роли требует предупреждения, поскольку это стабильный публичный идентификатор.
19. **HTML-патч выполнить по approved manifest замен, а не свободным regex по 3-МБ документу.**
  - сохранить полный before HTML и checksum;
  - зафиксировать точное ожидаемое количество замен для каждой карточки и кнопки;
  - сформировать approved after HTML и checksum;
  - UPDATE только при совпадении before checksum;
  - после UPDATE сравнить after checksum;
  - любое несовпадение — rollback.
20. **Visual regression уточнить:**
  - вне action-групп diff должен быть практически нулевым;
  - action-группы сравниваются отдельно по ширине, цветам, шрифтам и координатам;
  - изменение количества и текста кнопок является допустимой разницей;
  - проверить desktop, mobile и состояние с минимальным/максимальным числом активных offers.
21. **Live-config тест должен восстанавливать данные через** `finally`**:**
  - snapshot offer до теста;
  - disable → verify hidden;
  - rename → verify label;
  - reorder → verify visual position;
  - создать временный offer → verify appearance;
  - удалить временный offer;
  - полностью восстановить snapshot и подтвердить checksum.
22. **Порядок выполнения:**
  ```text
  Discovery + frozen manifests
  → schema/index и backfill meta
  → код bridge/parent с backward compatibility
  → deploy кода
  → HTML slot migration
  → runtime E2E
  → live-config proof
  → closeout

  ```
  Нельзя сначала заменить HTML-атрибуты и только потом деплоить поддержку `open-slot`: между шагами кнопки перестанут работать.
23. Старую ветку `TARIFF_KEY_NAME_MATCH` и `pickOfferForFlow` оставить только для legacy HTML. Сейчас именно она обрабатывает `open-payment/open-installment/...`. Для `/cb` после миграции должен быть proof, что ни один клик больше не попадает в legacy-ветку.
24. **Одобрение распространяется сразу на discovery и conditional execution.** Дополнительные approve между schema, code и HTML не нужны, если:
  - frozen manifests совпали;
  - preflight прошёл;
  - последовательность деплоя соблюдена;
  - любой drift приводит к fail-closed остановке до HTML cutover.

После этих правок Phase B можно выполнять одним проходом.

&nbsp;

План: Phase B — динамические кнопки на /cb, привязка к точным offers PRD-000039

## Diagnose

Текущее поведение (после успешной привязки /cb → PRD-000039):

1. Кнопки в HTML-блоке `/cb` статичны — тексты, порядок и наличие управляются только Tilda-разметкой, не админкой.
2. Iframe-bridge посылает `site-action { action, payload: { tariff_key } }` в parent; parent резолвит tariff по regex `TARIFF_KEY_NAME_MATCH` (сопоставление по имени — запрещено ТЗ) и offer через `pickOfferForFlow` (первый подходящий).
3. У «Главный бухгалтер» два активных `pay_now/internal_installment` — `pickOfferForFlow` вернёт первый, что не гарантирует корректный выбор для конкретной кнопки («в два этапа» vs «на 3 месяца»).
4. Отключённый offer оставляет кнопку в DOM: клик логирует warning, ничего не открывает.
5. `button_label`, `sort_order`, `is_active` из админки не отражаются на сайте.

## Цель

Кнопки на `/cb` становятся полностью данными продукта PRD-000039: включение/отключение, переименование, порядок и добавление новых работают без релиза сайта и без правки HTML источника. Дизайн (Tilda-классы, цвета, отступы, popup-разметка) сохраняется пиксель-в-пиксель.

## Архитектура: bridge sync + слоты + стабильные offer-роли

### 1. Стабильный ключ offer в БД (без имени)

Ввести `tariff_offers.meta.slot_role: text` — стабильный идентификатор роли кнопки внутри тарифа. Пример значений на /cb: `payment_card`, `payment_invoice`, `installment_2`, `installment_3`, `installment_bank`, `lead`. Роль задаётся админом продукта, уникальна в пределах `(tariff_id, slot_role)`.

Backfill для PRD-000039 (одноразовый, идемпотентный) — по существующим `button_label` + `payment_method` + `installment_count`:

- «Оплата картой / Оплатить обучение» без tokenization → `payment_card`
- «Оплатить от ЮЛ» (invoice-only по `detectInvoiceOnlyOffer`) → `payment_invoice`
- `internal_installment` с `installment_count=2` → `installment_2`
- `internal_installment` с `installment_count=3` → `installment_3`
- `bank_installment` → `installment_bank`
- `lead` → `lead`

Backfill выполняется как единичный `UPDATE ... WHERE meta->>'slot_role' IS NULL`. Ничего не удаляется, PRD-000003 не затрагивается. Admin UI получает поле «Роль на публичной странице» в форме offer (валидатор уникальности + подсказки допустимых значений).

Это устраняет и главный дефект (два `internal_installment` без различения).

### 2. Слоты в HTML `/cb` (одноразовая правка Tilda-экспорта)

Существующие кнопки в HTML `/cb` уже несут `data-lovable-action` + `data-tariff-key`. Заменяем это на стабильный слот:

```
data-lovable-slot="tariff:<tariff_code>|offer:<slot_role>"
```

Пример:

- `<a class="tn-atom" data-lovable-slot="tariff:cb20_buh|offer:payment_card">Оплата картой</a>`
- `<a ... data-lovable-slot="tariff:cb20_gl_buh|offer:installment_3">Рассрочка на 3 месяца</a>`

Контейнер, внутри которого живут кнопки одного тарифа, помечается:

```
data-lovable-slot-group="tariff:<tariff_code>"
```

Правка HTML — одноразовая, чисто разметочная (класс, цвет, layout не трогаем). Патч применяется к `site_pages.blocks[0].content.code` через один SQL `UPDATE` с pre/post md5 контролем. `landing_config`/`PricingSection` не подключаются.

Tariff `code` берём из БД: у PRD-000039 они уже стабильны (`buh`, `gl_buh`, `biz-l` мигрируем к явным `cb20_buh` и т.д. — либо оставляем как есть; уточним на исполнении, requirement — использовать UUID **или** stable code, `code` подходит).

### 3. Bridge sync: parent → iframe (offer manifest)

Расширяем bridge в `HtmlIframePreview.tsx` и `SitePageBySlug.tsx`:

Parent, зная `linkedProductData` (уже фетчит через `usePublicProduct(page.product_id)`), формирует manifest:

```
{
  type: 'lovable-slot-manifest',
  version: 1,
  tariffs: [
    { code: 'cb20_gl_buh', offers: [
      { slot_role: 'payment_card', id: '<uuid>', label: 'Оплатить обучение', sort_order: 1 },
      { slot_role: 'installment_3', id: '<uuid>', label: 'Рассрочка на 3 месяца', sort_order: 3 },
      ...
    ]},
    ...
  ]
}
```

Manifest постится в iframe через `iframe.contentWindow.postMessage(...)` при (a) готовности bridge (`iframe-resize` first message), (b) любом изменении `linkedProductData` (React Query invalidation).

### 4. Bridge на стороне iframe: применение manifest

В `BRIDGE_SCRIPT` добавляем обработчик `lovable-slot-manifest`:

Для каждого `[data-lovable-slot-group="tariff:<code>"]`:

1. Соберём все прямые дочерние `[data-lovable-slot]` — это «слоты-исходники».
2. Первый встреченный слот каждой роли (`data-lovable-slot="…|offer:<role>"`) сохраняется как **template** (клонируется, скрывается через `display:none` + `data-lovable-slot-template="1"`). Это гарантирует Tilda-дизайн: template повторяет layout соседних кнопок.
3. Из manifest получаем упорядоченный (`sort_order`) список активных offers для этого тарифа.
4. Для каждой offer:
  - Если DOM-узел с этой ролью уже есть в группе — обновляем `textContent` на `offer.label`, ставим атрибут `data-lovable-offer-id="<uuid>"`, снимаем `hidden`.
  - Если нет — клонируем template этой роли (если template есть; если нет — падаем на fallback: клон первого слота группы), заполняем label + id, вставляем в конец группы.
5. Слоты, для которых нет активного offer в manifest, скрываются `hidden` + помечаются `data-lovable-slot-inactive="1"`. Физически не удаляются, чтобы восстановление было мгновенным.
6. Порядок применяется через `container.appendChild(slot)` в порядке возрастания `sort_order` (внутри group).

Точка обновления текста — только «конечная» текстовая нода кнопки (`.tn-atom`, `.tn-atom__text`, либо fallback `element` без потомков-элементов), чтобы не сломать Tilda-иконки/svg внутри.

### 5. Клик через слот, не через flow-name

Существующий click-handler в iframe остаётся, но теперь для элементов со `data-lovable-slot` вместо `action` кладёт `slot` в payload:

```
parent.postMessage({ type: 'site-action', action: 'open-slot',
  payload: { tariff_code, slot_role, offer_id } }, '*')
```

Parent в `SitePageBySlug`:

- Валидирует `offer_id` — UUID_RE.
- Резолвит `offer` через `linkedProductData` по `id === offer_id` (UUID-driven, без regex по имени).
- Резолвит `tariff` как parent offer'а.
- Открывает `PaymentDialog | InvoiceCheckoutDialog | LeadRequestDialog | PreregistrationDialog` по тому же селектору, что и раньше (`offer.offer_type`, `detectInvoiceOnlyOffer`, `bank_installment` meta) — канонический flow, никакой дупликации логики оплаты.

Старая ветка (`open-payment` / `open-installment` / …) сохраняется как back-compat для других HTML-блоков и остаётся deprecated (лог debug при попадании в неё для /cb). Не удаляем — вне scope.

Удаляем/заменяем `TARIFF_KEY_NAME_MATCH` для новой ветки — сопоставление по имени больше не используется.

## Файлы для правки

1. `supabase/migrations/<ts>_offer_slot_role.sql` — колонка/индекс + backfill для PRD-000039 (только PRD-000039).
2. `src/components/shared/HtmlIframePreview.tsx` — обработчик `lovable-slot-manifest` в BRIDGE_SCRIPT + click-slot ветка; API для parent — proxy postMessage к `iframe.contentWindow`.
3. `src/pages/SitePageBySlug.tsx` — построение manifest из `linkedProductData`; отправка при готовности bridge и при изменении данных; новый handler `open-slot` (UUID-driven), сохраняющий текущий выбор диалога.
4. `src/pages/admin/...` (форма offer) — поле `slot_role` в admin UI PRD-000039 offers.
5. Одноразовая SQL-миграция `<ts>_cb_html_slot_markup.sql` — правка `site_pages.blocks[0].content.code` (замена `data-lovable-action`/`data-tariff-key` на `data-lovable-slot` + групповые контейнеры). Pre/post md5 логируется, `landing_config` НЕ трогается, дизайн-классы сохраняются.

## Инварианты

- Дизайн `/cb` неизменен: скриншот-регрессия до/после (Playwright, viewport 1280×1800 desktop и 390×844 mobile) — pixel diff ≤ 0.5%.
- Все Tilda-классы и структура popup'ов не тронуты.
- UUID `offer_id` — единственный ключ выбора offer в parent; сопоставление по имени отсутствует.
- `code` тарифа стабилен (не переименовывается свободным текстом); переименование name не рушит связь.
- PRD-000003 не затронут ни SQL, ни HTML-правкой.
- Fail-closed: при отсутствии `linkedProductData` или невалидном manifest все `data-lovable-slot` скрыты, клики no-op (лучше «пусто», чем «мёртвая кнопка»).

## Live-config proof (в отчёте)

Записать сценарии в discovery + приложить видео/скриншоты:

1. Отключить `is_active` у `installment_3` тарифа gl_buh → на `/cb` кнопка «Рассрочка на 3 месяца» исчезает в течение TTL React Query invalidation (≤ 30 сек, кнопка Refresh — мгновенно).
2. Переименовать `button_label` «Оплатить обучение» → «Начать сейчас» → надпись меняется на сайте без релиза.
3. Создать новый offer с `slot_role=payment_card_promo` и обновить template в HTML (если роли новой ещё нет — потребуется новый template в HTML, документируем как «новая роль → одноразовый minor edit HTML»). Для уже размеченных ролей — pure data.
4. Изменить `sort_order` двух internal_installment → визуальный порядок меняется.

## DoD

- SQL миграция `slot_role` применена, backfill 100% для PRD-000039, `NULL` только у offers, для которых нет соответствующей кнопки на /cb.
- HTML `/cb` содержит `data-lovable-slot` на всех 3×N кнопках, `data-lovable-slot-group` на 3 карточках; `data-lovable-action`/`data-tariff-key` для этих кнопок удалены.
- Скриншот-регрессия PASS.
- E2E (Playwright): для каждой активной offer PRD-000039 клик → корректный диалог с корректным `offer_id` (проверка через сетевой запрос или dialog-title).
- Live-config toggle proof: 4 сценария выше — PASS.
- Отчёт `.lovable/discovery/cb_phase_b_report.md` с md5 HTML до/после, списком backfill, ссылками на E2E-артефакты.

## Rollback

- HTML rollback: обратная миграция восстанавливает `data-lovable-action`/`data-tariff-key` (сохраняем оригинал в `.lovable/discovery/cb_html_before_phase_b.html`, храним md5 в миграции).
- Slot_role rollback: колонку не дропаем, но обнуляем meta.slot_role для PRD-000039 (одна `UPDATE`).
- Code rollback: удалить обработчик `open-slot` и sync manifest, ветка `open-payment/open-installment/...` уже сохранена — старая логика продолжает работать.

Ожидаю подтверждения. По одобрении: сначала discovery-запрос к БД (все offers PRD-000039, точные `slot_role` для backfill, snapshot HTML), затем миграции (schema → backfill → HTML) в отдельных approve-шагах, затем код и E2E.