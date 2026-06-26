## да, согласен, с учетом правок:

1. **Расширить scope по card tokenization глобально**

Не ограничиваться только оффером:

```text
offer_id = 891c7fe0-eb9d-4853-a1d5-bb69d688c801
```

Нужно добавить отдельный блок:

```text
PATCH: disable card tokenization / saved-card requirement globally
```

Цель: убрать обязательную привязку карты из всех новых и текущих флоу оплаты, если она не является реально используемым платежным механизмом.

2. **Проверить фактическую модель card binding / MIT**

Перед изменениями обязательно сделать read-only discovery:

- где используется `requires_card_tokenization`;
- есть ли поля типа:
  - `requires_card_tokenization`
  - `save_card`
  - `card_token_required`
  - `tokenization_required`
  - `recurring_token`
  - `mit`
  - `customer_payment_method`
- какие edge-функции читают эти поля:
  - bePaid checkout;
  - Stripe checkout;
  - public payment links;
  - PaymentDialog;
  - ProductLanding;
  - offer/tariff admin editor.

3. **Зафиксировать новое правило**

Добавить в план:

```text
Привязка карты не является обязательным условием покупки, trial-доступа, создания заказа или активации доступа.

Если сохранённая карта когда-либо используется, это только optional convenience feature для уже авторизованного клиента, но не обязательный checkout step.

MIT / auto-charge / tokenized card flow не используется как обязательный бизнес-флоу и должен быть выключен по умолчанию.
```

4. **Отключить обязательную токенизацию не только в одном оффере**

Миграция должна сделать минимум:

```sql
update tariff_offers
set requires_card_tokenization = false
where coalesce(requires_card_tokenization, false) = true;
```

И дополнительно, если есть поля автосписания trial:

```sql
update tariff_offers
set auto_charge_after_trial = false
where coalesce(auto_charge_after_trial, false) = true;
```

Но только после проверки реальных колонок.

5. **Запретить включение токенизации в UI создания/редактирования оффера**

В админке офферов/кнопок оплаты:

- убрать переключатель «обязательная привязка карты», если он есть;
- либо оставить только как disabled/hidden deprecated;
- при сохранении оффера всегда отправлять:
  - `requires_card_tokenization=false`
  - `auto_charge_after_trial=false`, если поле есть и относится к автосписанию.

6. **Запретить backend принимать обязательную токенизацию из payload**

Даже если frontend случайно отправит `requires_card_tokenization=true`, backend должен нормализовать:

```text
requires_card_tokenization=false
```

Иначе старые UI/скрипты смогут снова включить обязательную привязку.

7. **PaymentDialog должен идти обычным checkout-флоу**

Для trial-оффера:

- не запрашивать карту;
- не открывать tokenization/MIT flow;
- создавать обычный order/trial activation;
- grant-access-for-order выдаёт доступ по `access_rules`;
- после 24 часов доступ истекает;
- автоматического списания нет.

8. **Уточнить формулировку про “MID”**

В плане заменить:

```text
MIT-флоу с токенизацией карты
```

на более точное:

```text
обязательная токенизация / привязка карты для будущих списаний
```

Потому что по текущему бизнес-правилу нет отдельного обязательного MIT-платежного сценария; оплата должна идти через обычный bePaid или Stripe checkout.

9. **Добавить DoD по глобальному отключению**

В DoD добавить:

- новый оффер создаётся с `requires_card_tokenization=false`;
- существующие офферы после миграции имеют `requires_card_tokenization=false`;
- trial-оффер открывается без запроса карты;
- PaymentDialog не показывает обязательную привязку карты;
- bePaid/Stripe обычные оплаты не сломаны;
- сохранённая карта, если где-то отображается, не блокирует оплату и не является обязательной;
- `auto_charge_after_trial=false` для trial, если такое поле есть.

10. **Бридж iframe → PaymentDialog оставить**

Сам bridge-план корректный:

- iframe остаётся sandbox без `allow-same-origin`;
- из HTML передаются только UUID;
- host валидирует action и UUID;
- открывается существующий `PaymentDialog`;
- HTML snapshot перед миграцией обязателен.

11. **Runtime smoke расширить**

Добавить проверки:

- trial guest flow без карты;
- existing user flow без карты;
- logged-in flow без карты;
- обычная платная покупка через bePaid/Stripe не требует обязательной привязки карты;
- trial не создаёт автосписание после 24 часов;
- доступ выдан только к «База знаний», без вебинаров/эфиров.

После этих правок план можно выполнять.

дополни, что окно активации демо доступа должно быть в цветах и стиле существующего сайта по идеологии

Контекст и root cause

На странице `ideologicheskaya-rabota` (SITE-000018, продукт PRD-000037 «Gorbova Club — идеология») три CTA-кнопки:

- «Разблокировать участие» (hero / блок поиска)
- «Получить доступ к 600+ ответам» (нижний CTA)
- «Участвовать» (карточки ответов экспертов)

Сейчас они — статичный HTML внутри одного html-блока (block.type = `html`), который рендерится в **песочнице iframe без allow-same-origin** (`HtmlIframePreview`). Поэтому никакие прямые вызовы PaymentDialog/Supabase из HTML невозможны. Нужен мост: iframe → parent → открыть существующий `PaymentDialog` в режиме trial-оффера.

Целевой оффер уже существует:

- `tariff_id = 85863b4b-c5e4-4f43-884d-2bdbe48d3914` («Доступ к +600 ответов»)
- `offer_id = 891c7fe0-eb9d-4853-a1d5-bb69d688c801` (trial, amount=0, trial_days=1, payment_method=full_payment)
- CRM routing на оффере → воронка «Gorbova Club» (success-стадия `40325a3a…`)
- `access_rules`: tariff даёт `section_access → База знаний`. Других доступов (тренинг/club/эфиры) у тарифа нет → требование «только база знаний, без вебинаров» выполняется автоматически через grant-access-for-order.

Проблемная настройка оффера: `requires_card_tokenization = true`. Это включает MIT-флоу с токенизацией карты, что противоречит требованию «просто получает доступ на 24 часа без карты, как обычный заказ trial». Нужно выставить `false`.

## План

### 1. Бридж iframe ↔ parent для site-action (инфраструктура)

`src/components/shared/HtmlIframePreview.tsx`:

- Расширить `BRIDGE_SCRIPT`: в capture-обработчике клика, перед anchor-логикой, проверять элемент (и его предков до `A`/`BUTTON`) на атрибут `data-lovable-action`. Если найден:
  - `ev.preventDefault(); ev.stopPropagation();`
  - `parent.postMessage({ type: 'site-action', action: el.dataset.lovableAction, payload: { offer_id: el.dataset.offerId, product_id: el.dataset.productId, tariff_id: el.dataset.tariffId } }, '*')`.
- В обработчике `handleMessage` родителя НЕ перехватывать `site-action` — пробросить через CustomEvent на `window` (`window.dispatchEvent(new CustomEvent('lovable:site-action', { detail }))`), чтобы host-страница могла подписаться без переписывания инфраструктуры.

Поддерживаемые действия (на этом этапе только одно): `open-offer` — открыть PaymentDialog для конкретного offer_id.

### 2. Host-обвязка: PaymentDialog на странице сайта

В компоненте, который рендерит публичные страницы (`SitePageView` / страница `/:slug` — найду в `src/pages/`, точка монтирования `SitePageRenderer`), добавить:

- `useState` для `pendingOffer: { offerId, productId } | null`.
- `useEffect` с подпиской `window.addEventListener('lovable:site-action', ...)`:
  - если `action === 'open-offer'` → загрузить product+tariff+offer (через существующий `usePublicProduct` по `productId`, найти оффер по `offerId`) и открыть PaymentDialog с пропсами `isTrial=true`, `trialDays=offer.trial_days`, `isSubscription=false`, `isClubProduct=true` (т.к. у продукта `telegram_club_id`).
- Условный рендер `<PaymentDialog />` с теми же контрактами, что в `ProductLanding.tsx` (id-first, без эвристик).

Для производительности: подгружать `public-product` лениво по первому клику, кэшировать в queryCache (`public-product-by-id`).

### 3. Правка HTML-блока страницы

Через миграцию обновить `site_pages.blocks` для `id = 7e672fed-13f1-4ff1-8786-71a228a0c011`:

- Заменить три CTA на `<button type="button" data-lovable-action="open-offer" data-product-id="3ea08f79-afe8-4361-81fe-4c0f318f9a2b" data-offer-id="891c7fe0-eb9d-4853-a1d5-bb69d688c801" class="…">…</button>`:
  - «Разблокировать участие» (hero)
  - «Получить доступ к 600+ ответам» (нижний CTA)
  - «Участвовать» в каждой карточке вопроса (текущая разметка их фиксирует — генерация карточек идёт скриптом, обновим шаблон карточки)
- Перед PATCH-ом — снять снапшот текущего HTML в `.lovable/artifacts/site018_pre_demo_cta.html` (dry-run).

### 4. Нормализация оффера

Миграция: `UPDATE tariff_offers SET requires_card_tokenization = false WHERE id = '891c7fe0-eb9d-4853-a1d5-bb69d688c801'` — без карты, чистый trial с auto-grant на 1 день. Проверить, что `auto_charge_after_trial = false` (если true — снять, иначе после 24ч пойдёт списание).

### 5. Verify (runtime smoke)

Под двумя ролями через Playwright против localhost:

- **Гость**: клик на «Получить доступ к 600+ ответам» → PaymentDialog → ввод нового email → guest-signup flow → активация → entitlement создан, `orders_v2.status='paid'`, в воронке Gorbova Club создана сделка на success-стадии, доступ к `/cabinet` к разделу «База знаний» открыт ровно на 24 часа.
- **Существующий клиент** ([1@ajoure.by](mailto:1@ajoure.by)): тот же клик → PaymentDialog → email распознан → запрос пароля → логин → активация trial → entitlement, сделка, доступ.
- **Уже залогинен**: клик → PaymentDialog сразу с активацией без формы.
- Verify, что разделы «Эфиры/Вебинары» видны со замком (продукт не покупался) — поведение `useAccessValidation` без правок.

### Технические детали

```text
iframe HTML button
  └─ data-lovable-action="open-offer"
     data-product-id="<uuid>"
     data-offer-id="<uuid>"
        │
        ▼ (BRIDGE_SCRIPT click capture)
postMessage { type: 'site-action', action, payload }
        │
        ▼ (HtmlIframePreview source-check)
window.dispatchEvent(CustomEvent 'lovable:site-action', { detail })
        │
        ▼ (host page useEffect)
usePublicProduct(productId) → find offer by id → <PaymentDialog isTrial trialDays …/>
```

Изоляция:

- iframe остаётся без `allow-same-origin` — нет утечки токенов.
- В сообщении передаются только UUIDы (никаких произвольных строк в URL/sql).
- В host-обработчике строгая валидация: `typeof action === 'string'`, UUID-regex для `productId/offerId`, allow-list `action ∈ {'open-offer'}`.
- Source-check `e.source === iframe.contentWindow` уже есть в HtmlIframePreview — расширим whitelist типов.

Файлы изменений:

- `src/components/shared/HtmlIframePreview.tsx` — BRIDGE_SCRIPT + handleMessage (`site-action`).
- `src/pages/<SitePageView>.tsx` (точное имя установлю при build) — подписка + PaymentDialog.
- Миграция: UPDATE `tariff_offers` (requires_card_tokenization) + UPDATE `site_pages.blocks` (HTML с data-* атрибутами).

### DoD

- Клик по любой из трёх CTA на `gorbova.by/ideologicheskaya-rabota` открывает диалог покупки trial-оффера.
- Гость / существующий / залогиненый — все три ветки заканчиваются активацией trial, созданием `orders_v2`, сделкой в воронке Gorbova Club, entitlement на 24ч, доступом к «База знаний» в кабинете.
- Карта не запрашивается (offer.requires_card_tokenization=false).
- Изоляция iframe сохранена (sandbox без allow-same-origin, UUID-валидация в host).
- Snapshot HTML до правки сохранён.
- Runtime smoke под Playwright задокументирован в отчёте.