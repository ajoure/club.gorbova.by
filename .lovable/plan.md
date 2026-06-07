## да, согласен, с учетом правок:

1. **Источник** `shop_id`

Не угадывать.

До реализации сделать read-only probe:

```sql
SELECT id, provider, account_code, account_name, capabilities_snapshot, meta
FROM acquiring_connections
WHERE provider='bepaid'
ORDER BY is_default DESC, created_at DESC;
```

Если `shop_id` есть в `capabilities_snapshot.shop_id` или `meta.shop_id` — использовать его.

Если `shop_id` не найден:

```text
label = account_name
fallback = account_code
```

Не делать seed-миграцию в этом патче.

2. **Если bePaid connections пустые**

Не делать seed-миграцию.

UI должен показать:

```text
Нет активного подключения bePaid.
Добавьте подключение в настройках эквайринга.
```

Save с bePaid включённым — disabled.

Это не задача PATCH 5-B.2.

3. **Источник** `isSubscription`

Не угадывать по одному полю.

Использовать тот же resolver, который уже применялся в public link / offer logic.

Порядок:

```text
1. offer.payment_type === 'subscription'
2. offer.type === 'subscription'
3. meta.recurring.is_recurring === true
4. selected payment mode subscription в форме
```

И зафиксировать выбранный фактический источник в proof.

4. **Advanced Stripe block**

Сделать свернутым по умолчанию.

Auto-open только если:

```text
Stripe включён
и offer is subscription
и price_id отсутствует
```

5. **Product ID**

Даже в advanced не показывать как основное поле.

Можно показывать только технической строкой после lookup:

```text
Служебный ID продукта: prod_…XXXX
```

мелким серым текстом, только если уже получен.

6. **Slug fallback**

В UI не показывать `stripe_poland`, если есть `account_name`.

Если `account_name` пустой, fallback допустим, но в proof зафиксировать как technical fallback.

7. **Перед build выполнить probes**

Добавить в начало:

```text
P0. Read-only probes:
- acquiring_connections bePaid
- acquiring_connections Stripe
- фактический источник shop_id
- фактический источник isSubscription
```

8. **Никаких backend/runtime изменений**

Подтвердить:

```text
PATCH 5-B.2 = UI/config-only
```

Не трогать provider choice runtime и public-checkout.

После этих правок можно выполнять.

&nbsp;

PATCH 5-B.2 — Упрощение настроек эквайринга кнопки + выбор подключения

### Цель

В админ-UI кнопки (вкладка «Оплата»): заменить технический Stripe-блок (Price ID / Product ID / test/live / «Подтвердить») на бизнес-настройку «какими картами принимаем + через какое конкретное подключение». Технические Stripe-поля (Price ID) спрятать в свёрнутый advanced-блок. Без изменений runtime (public-checkout, webhooks, grant-access, Phase 5-C).

---

### 1. Скоуп изменений (только UI/config)

**Файлы:**

- `src/components/admin/products/OfferAcquiringSettings.tsx` — переработка UI + расширение meta-контракта (`bepaid: {account_code, shop_id}`).
- `src/hooks/useTariffOffers.tsx` — расширить TypeScript-тип `OfferAcquiring` (добавить `bepaid?: {...}`, оставить `stripe?` совместимо).
- `.lovable/proofs/phase_5_b_2_acquiring_connection_selector_v1.md` — proof.
- `.lovable/plan.md` — отметка PATCH 5-B.2.

**НЕ трогаем:**

- `supabase/functions/public-checkout`, `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `subscriptions-reconcile`, `telegram-grant-access`.
- `_shared/resolve-provider-choice.ts`, `CustomerProviderChoice.tsx`, `PublicPayPage.tsx` — Phase 5-C runtime сохраняется как есть.
- DB-схема `acquiring_connections`, `tariff_offers`. DB-триггер валидации `meta.acquiring` оставляем; обновление триггера не требуется (новые `bepaid.*` ключи add-only, существующая валидация не падает).
- Edge function `admin-stripe-price-lookup` — остаётся как есть (используется только из advanced-блока).

---

### 2. Новый Meta-контракт (add-only, обратно совместим)

```json
{
  "allowed_payment_providers": ["bepaid", "stripe"],
  "default_provider": "bepaid",
  "customer_choice_enabled": true,
  "bepaid": {
    "account_code": "bepaid_main",
    "shop_id": "33524"
  },
  "stripe": {
    "account_code": "stripe_poland",
    "price_id": "price_...",
    "product_id": "prod_...",
    "currency": "EUR",
    "mode": "live"
  }
}
```

Backward compat:

- Старые офферы без `bepaid.*` → при открытии формы автоподставляем default active bePaid connection (не сохраняем до явного Save).
- Старые офферы с `meta.acquiring.stripe.*` → значения сохраняются 1:1, отображаются в advanced-блоке.

---

### 3. UI-структура (новый OfferAcquiringSettings)

**Блок «Способы приёма оплаты»:**

```
☑ Принимать белорусские карты (bePaid)
   Подключение: [Select: список acquiring_connections WHERE provider='bepaid' AND status='active']
   Опции: account_name (если пусто → "bePaid — Shop ID {shop_id}")
   Бейдж справа: [Тестовое подключение] / [Боевое подключение] — read-only

☑ Принимать иностранные карты (Stripe)
   Подключение: [Select: список acquiring_connections WHERE provider='stripe' AND status='active']
   Опции: account_name (например "Stripe — Gorbova.pl"); slug stripe_poland не виден
   Бейдж справа: [Тестовое] / [Боевое] — read-only

   ▸ Дополнительные настройки Stripe   (collapsible, свернут по умолчанию)
     ─ Код тарифа Stripe: [price_...]  [Проверить]
       Подсказка: "Используется только для подписок Stripe. Обычно заполняется интегратором."
       Для one-time оффера Price ID не обязателен.
       Если оффер subscription + Stripe включен + price_id пуст → красное предупреждение и blockSave.
```

Подвал:

```
Покупатель сможет выбрать карту белорусского или иностранного банка.
```

(в зависимости от выбранных провайдеров — копия как сейчас).

**Что удаляется из видимой формы:**

- Поле «Код тарифа Stripe» из основного уровня (переезжает в advanced).
- Read-only грид «Валюта / Режим / Product ID» в основном уровне (переезжает в advanced, видно только когда `stripeReady`).
- Radio-group «Тестовый / Боевой режим» (нередактируемо, режим = `test_mode` выбранного `acquiring_connection`).
- Кнопка «Подтвердить» из основного уровня (остаётся внутри advanced).

---

### 4. Логика выбора подключения

- При маунте: загрузить `acquiring_connections` отдельно для `bepaid` и `stripe` (status='active'), сортировка `is_default DESC, account_name`.
- bePaid options label: `account_name || "bePaid — Shop ID " + (metadata.shop_id ?? account_code)`.
- Stripe options label: `account_name || "Stripe — " + account_code` (но slug-fallback не предпочтителен; в норме всегда есть account_name).
- При включении провайдера, если в meta нет `account_code` → автоподставить `is_default || first`.
- При смене подключения в селекторе:
  - bePaid: сохранить `bepaid: {account_code, shop_id: metadata.shop_id ?? null}`.
  - Stripe: сохранить `stripe.account_code`, инвалидировать `product_id/currency/mode` (требует повторного Lookup в advanced для подписки).
- Режим (`test_mode`) **только отображаем** бейджем из выбранного `acquiring_connections.test_mode`. В meta `stripe.mode` синхронизируем для совместимости с runtime.

---

### 5. Advanced-блок Stripe

- Collapsible (`<Collapsible>` из `@/components/ui/collapsible`), defaultOpen=false.
- Авто-раскрывается, если оффер subscription и `price_id` пуст (для привлечения внимания).
- Внутри: Input price_id + кнопка «Проверить» (вызывает существующий `admin-stripe-price-lookup` с текущим `account_code`).
- Read-only грид показывает `product_id` (укорочен `prod_…XXXX`), currency, mode.

---

### 6. Валидация (frontend + save-time)

Расширить `validateOfferAcquiring(acq, isInstallment, isSubscription)`:

- bePaid выбран → требуется `bepaid.account_code`.
- Stripe выбран → требуется `stripe.account_code`.
- Stripe выбран + `isSubscription` → требуется `stripe.price_id`.
- Stripe выбран + one-time → `price_id` опционален.
- installment + Stripe → блок (как сейчас).

В `AdminProductDetailV2.handleSaveOffer` пробросить `isSubscription` (значение уже доступно из формы).

---

### 7. Verify (UI-only, до approve)


| #   | Сценарий                                                     | Ожидание                                                                                   |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| V1  | Открыть оффер с `acquiring.bepaid` отсутствует               | Селектор bePaid автозаполнен default подключением, save разрешён                           |
| V2  | Открыть оффер с legacy `stripe.price_id`, без `bepaid`       | Selector Stripe = подключение по `account_code`, advanced раскрыт, price_id виден          |
| V3  | Переключить Stripe-подключение                               | `product_id/currency/mode` инвалидируются, advanced раскрывается, badge режима обновляется |
| V4  | One-time + Stripe без price_id                               | Save разрешён (price_id не требуется)                                                      |
| V5  | Subscription + Stripe без price_id                           | Save заблокирован, advanced раскрыт, красное предупреждение                                |
| V6  | Снять обе галочки                                            | Toast «Выберите хотя бы один способ оплаты», save заблокирован                             |
| V7  | Installment + попытка включить Stripe                        | Toast, чекбокс disabled                                                                    |
| V8  | grep `stripe_poland` в видимых JSX-строках                   | 0 совпадений (только в meta/runtime/option fallback)                                       |
| V9  | Phase 5-C: открыть public payment link с обоими провайдерами | CustomerProviderChoice работает (no regression)                                            |


---

### 8. Zero-diff freeze

```
supabase/functions/public-checkout
supabase/functions/bepaid-webhook
supabase/functions/stripe-webhook
supabase/functions/grant-access-for-order
supabase/functions/subscriptions-reconcile
supabase/functions/_shared/resolve-provider-choice.ts
supabase/functions/_shared/stripe-subscription-resolver.ts
src/components/payments/CustomerProviderChoice.tsx
src/pages/PublicPayPage.tsx
src/utils/resolveCustomerProviderChoice.ts
```

Подтвердить grep-ом в proof.

---

### 9. DoD

- Селектор подключения bePaid + Stripe в UI оффера.
- Slug `stripe_poland` не виден в админ-UI (кроме fallback-label, если account_name пуст).
- Price ID скрыт в advanced, не обязателен для one-time.
- test/live read-only бейдж из `acquiring_connections.test_mode`.
- Существующий `price_id` не теряется (миграция в advanced при чтении).
- Phase 5-C runtime не сломан (V9).
- Proof `.lovable/proofs/phase_5_b_2_acquiring_connection_selector_v1.md` + grep zero-diff.
- `.lovable/plan.md` обновлён: PATCH 5-B.2 = DONE.

---

### Открытые вопросы (нужны до старта build)

1. **Источник `shop_id` для bePaid:** в `acquiring_connections` нет колонки `shop_id`; предполагаю хранение в `capabilities_snapshot` или `metadata`-подобном jsonb. Подтверди ключ (например `capabilities_snapshot.shop_id` или отдельная колонка) — иначе оставлю fallback на `account_code`.
2. **Источник `account_name` bePaid-подключений:** сейчас в БД для bePaid записей в `acquiring_connections` они есть? Если таблица пуста для provider='bepaid' → нужен ли seed-миграция (out-of-scope PATCH 5-B.2) или OK показать пустой селектор с подсказкой «Добавьте подключение bePaid в настройках эквайринга»?
3. **Поле `isSubscription` в форме оффера:** подтверди, что у нас есть надёжный признак (`offer.kind === 'subscription'` или `meta.recurring.is_recurring`) — он будет источником для условной валидации price_id.