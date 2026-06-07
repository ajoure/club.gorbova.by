# да, согласен, с учетом правок:

1. **Не делать бэкфилл до появления UI**

Сейчас в базе:

```text
38 offers
1 offer со Stripe
0 meta.acquiring
```

Если сначала сделать массовый бэкфилл, а потом UI, то при ошибке UI придется чинить уже измененные данные.

Порядок лучше такой:

```text
5-B.1 UI
5-B.2 Verify UI
5-B.3 Dry-run backfill
5-B.4 Execute backfill
5-B.5 Verify
```

---

2. **Не хранить product_id вручную**

Поле:

```json
"product_id": "prod_xxx"
```

я бы не редактировал руками.

Показывать:

```text
Stripe Product ID
```

можно.

Но редактировать вручную нельзя.

Источник должен быть:

```text
Stripe Price ID
↓
Stripe API
↓
Stripe Product ID
```

Иначе через месяц получим:

```text
price_1
product_2
```

и рассинхрон.

Для 5-B достаточно:

```json
{
  "price_id": "...",
  "account_code": "...",
  "currency": "...",
  "mode": "..."
}
```

---

3. **Currency не должна редактироваться отдельно**

Сейчас уже есть риск появления:

```text
Price ID = EUR
Currency = USD
```

Для Stripe это ошибка данных.

Поэтому Discovery уже показал:

```text
price_id = главный идентификатор
```

В 5-B:

```text
Price ID
```

обязателен.

А валюта:

```text
read-only
```

подтягивается автоматически.

---

4. **default_provider**

В плане написано:

```text
default_provider = bepaid
```

Нужно добавить правило:

```text
если allowed=["stripe"]
то default_provider="stripe"
```

автоматически.

Не хранить неконсистентные данные.

---

5. **Stripe-only офферы разрешить**

Сейчас план не запрещает, но явно не описывает.

Добавить:

```text
☐ bePaid
☑ Stripe
```

валидный сценарий.

Тогда:

```json
{
  "allowed_payment_providers": ["stripe"],
  "default_provider": "stripe"
}
```

---

6. **Installment guard усилить**

Не только disabled checkbox.

Еще и серверная защита при сохранении:

```text
installment + stripe
=
400 stripe_installment_not_supported
```

Даже если кто-то обойдет UI.

---

7. **Audit по изменениям оффера**

Кроме массового backfill нужен обычный аудит.

При изменении настроек оффера:

```text
offer.acquiring.updated
```

с записью:

```json
{
  "offer_id": "...",
  "old_providers": [...],
  "new_providers": [...],
  "old_price_id": "...",
  "new_price_id": "...",
  "actor_id": "..."
}
```

Иначе потом невозможно будет понять, кто отключил Stripe.

---

8. **Добавить Verify для сохранения**

После UI save проверить:

```text
offer A
  bePaid only

offer B
  bePaid + Stripe

offer C
  Stripe only
```

и подтвердить фактический JSON в БД.

Не только визуальный скриншот.

---

9. **Proof дополнить**

Добавить отдельный раздел:

```text
JSON before
JSON after
```

для трех сценариев:

```text
bePaid only
bePaid + Stripe
Stripe only
```

Это пригодится перед Phase 5-C.

После этих правок Phase 5-B выглядит безопасной и может идти в реализацию.

&nbsp;

План: Phase 5-B — Offer Acquiring Settings UI + Backfill

## Цель

Добавить в карточку оффера (вкладка «Оплата») управление эквайрингом и сделать идемпотентный бэкфилл `tariff_offers.meta.acquiring` для 38 офферов.

**Никаких runtime-изменений:** public-checkout, admin override, webhooks, grant-access, bePaid/Stripe lifecycle — не трогаем. Только запись настроек + UI редактор.

---

## Scope 5-B

### 1. Контракт `meta.acquiring`

```json
{
  "allowed_payment_providers": ["bepaid"] | ["bepaid","stripe"] | ["stripe"],
  "default_provider": "bepaid" | "stripe",
  "customer_choice_enabled": false,
  "stripe": {
    "account_code": "stripe_poland",
    "product_id": "prod_...",
    "price_id": "price_...",
    "currency": "EUR" | "USD" | ...,
    "mode": "test" | "live"
  }
}
```

`stripe`-блок присутствует только если `stripe ∈ allowed_payment_providers`.

### 2. Бэкфилл (Diagnose → Dry-run → Execute → Verify)

**Источник правды:** `tariff_offers` (38 строк, 26 active).

**Diagnose (read-only SQL):**

```sql
SELECT id, name, is_active,
       meta->'stripe'->>'price_id'   AS stripe_price_id,
       meta->'stripe'->>'product_id' AS stripe_product_id,
       meta->'acquiring'             AS existing_acquiring
FROM tariff_offers
ORDER BY is_active DESC, name;
```

Ожидание (по Discovery 5-A): 1 оффер с `stripe.price_id`, 0 уже с `meta.acquiring`.

**Dry-run выборка:**

```sql
SELECT id, name,
  CASE WHEN meta->'stripe'->>'price_id' IS NOT NULL
       THEN '["bepaid","stripe"]' ELSE '["bepaid"]' END AS would_set_providers
FROM tariff_offers
WHERE meta->'acquiring' IS NULL;
```

**Execute (idempotent UPDATE через supabase--insert, single transaction):**

Правила:

- `meta.stripe.price_id IS NOT NULL` → `allowed_payment_providers=["bepaid","stripe"]`, перенести существующие `meta.stripe.{account_code,product_id,price_id,currency,mode}` в `meta.acquiring.stripe` (если поля пустые — `account_code='stripe_poland'`, `mode='test'`, `currency` из `tariff_prices`/`'EUR'` fallback).
- иначе → `allowed_payment_providers=["bepaid"]`, без `stripe`-блока.
- всегда: `default_provider="bepaid"`, `customer_choice_enabled=false`.
- guard: `WHERE meta->'acquiring' IS NULL` — идемпотентно.
- `meta.stripe` **оставляем как есть** (backward-compat для `stripe-subscription-resolver`).

**Audit:** одна запись в `audit_logs` с `action='phase5_b_acquiring_backfill_v1'`, `meta.affected_count`, `meta.affected_ids[]`, `meta.dry_run_snapshot`.

**Verify:**

```sql
SELECT COUNT(*) FILTER (WHERE meta->'acquiring' IS NOT NULL) AS filled,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE (meta->'acquiring'->'allowed_payment_providers') @> '["stripe"]') AS with_stripe
FROM tariff_offers;
```

Ожидание: `filled=total=38`, `with_stripe=1`.

**Rollback (если нужно):** `UPDATE tariff_offers SET meta = meta - 'acquiring' WHERE meta->'acquiring'->>'__backfill_marker__' = 'phase5_b_v1'`. Для этого в backfill добавим `meta.acquiring.__backfill_marker__='phase5_b_v1'`.

### 3. UI — вкладка «Оплата» в карточке оффера

**Файл:** `src/pages/admin/AdminProductDetailV2.tsx` (район строк 1729-1733, существующая вкладка «Оплата» в Offer dialog). Извлечь блок в новый компонент `src/components/admin/products/OfferAcquiringSettings.tsx`.

**Раскладка:**

```
Способы приёма оплаты
┌────────────────────────────────────────────────┐
│ ☑ bePaid — карты банков Беларуси               │
│ ☐ Stripe — карты иностранных банков            │
└────────────────────────────────────────────────┘

[если Stripe ☑]
Настройки Stripe
┌────────────────────────────────────────────────┐
│ Аккаунт:     [stripe_poland ▾]                 │  (из acquiring_connections WHERE provider='stripe' AND is_active)
│ Product ID:  [prod_...                       ] │
│ Price ID:    [price_...                      ] │  *required
│ Валюта:      [EUR ▾]                           │
│ Режим:       (○) test  ( ) live                │
└────────────────────────────────────────────────┘
```

**Валидация (frontend + backend mirror в save-handler):**

1. Минимум один провайдер включён → иначе toast «Выберите хотя бы один способ оплаты», кнопка «Сохранить» disabled.
2. Если Stripe включён → `price_id` обязателен → иначе «Укажите Stripe Price ID», disabled.
3. **Installment guard:** если в оффере `meta.installment.enabled === true` → чекбокс Stripe **disabled** + подпись «Stripe пока не поддерживает рассрочку». Сохранять Stripe для installment-офферов запрещено (если флаг включён программно — strip + warn).
4. `default_provider` в 5-B не редактируется в UI, фиксируется `"bepaid"` (при single-provider Stripe-only сценарии — авто `"stripe"`; такие офферы в текущем датасете отсутствуют).
5. `customer_choice_enabled=false` (UI 5-C добавит тумблер).

**Save:** запись в `tariff_offers.meta.acquiring` через существующий update-handler оффера (один PATCH, никакой новой edge function). `meta.stripe` не удаляем (legacy read-path).

**Что НЕ делаем в 5-B:**

- никакой user-facing UI (карта-селектор на сайте) — Phase 5-C;
- никакой admin override в checkout-форме — Phase 5-D;
- никакого изменения `payment_links_enriched_v` — Phase 5-C/D;
- никаких правок `create-stripe-checkout`, `stripe-pre-create-subscription`, `public-checkout`, `admin-create-public-link`, `create-payment-checkout`, `bepaid-webhook`, `stripe-webhook`, `stripe-subscription-resolver`, `grant-access-for-order`.

---

## Технические детали

**Изменяемые файлы:**

- `src/components/admin/products/OfferAcquiringSettings.tsx` (новый, ~180 строк)
- `src/pages/admin/AdminProductDetailV2.tsx` (вставка компонента во вкладку «Оплата», ~5 строк diff)
- `.lovable/proofs/phase_5_b_offer_acquiring_settings_v1.md` (новый proof)

**Migration:** не требуется (только JSONB-апдейт через `supabase--insert`).

**Тип контракта:** добавить локальный TS-тип `OfferAcquiring` в `OfferAcquiringSettings.tsx` (без правки `src/integrations/supabase/types.ts`).

---

## Proof (`.lovable/proofs/phase_5_b_offer_acquiring_settings_v1.md`)

Структура:

1. Discovery snapshot (38 offers, 1 с stripe.price_id).
2. Dry-run SQL + результат.
3. Execute SQL + audit row.
4. Verify SQL + результат (filled=38, with_stripe=1).
5. Скриншоты UI: bePaid only, bePaid+Stripe, валидация «оба выключены», installment guard.
6. Grep-проверки (zero-diff):
  - `git diff --stat supabase/functions/bepaid-webhook supabase/functions/stripe-webhook supabase/functions/grant-access-for-order supabase/functions/_shared/stripe-subscription-resolver.ts supabase/functions/public-checkout supabase/functions/create-stripe-checkout.ts supabase/functions/stripe-pre-create-subscription.ts supabase/functions/admin-create-public-link supabase/functions/create-payment-checkout.ts` → 0.
7. Rollback команда.

---

## Runtime gates 5-B

- **G81-B** UI «Способы приёма оплаты» отображается во вкладке «Оплата» оффера.
- **G82-B** Save заблокирован, если оба провайдера выключены.
- **G83-B** Save заблокирован, если Stripe включён без `price_id`.
- **G84-B** Installment-оффер → Stripe checkbox disabled + подпись.
- **G85-B** Бэкфилл идемпотентен: повторный запуск `affected_count=0`.
- **G86-B** Zero-diff на runtime-файлах (grep §6 proof).

---

## DoD

- `meta.acquiring` заполнен для 38/38 офферов.
- UI рендерится, все 4 валидации работают.
- Audit `phase5_b_acquiring_backfill_v1` записан.
- Proof-файл создан с SQL до/после, скриншотами, grep-результатами.
- G81-B…G86-B = PASS.
- Plan-файл `.lovable/plan.md` обновлён: Phase 5-B = DONE, 5-C/5-D = PENDING.

После approve — выполняю Diagnose → Dry-run → подтверждение → Execute → UI → Verify.