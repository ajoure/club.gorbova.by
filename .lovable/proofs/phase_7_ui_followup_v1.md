# Phase 7-UI follow-up — DB hotfix `acquiring_stripe_missing_price_id` + screenshot smoke S1–S8

Дата: 2026-06-07
Статус: **DB hotfix = APPLIED**, UI code = PASS, screenshot smoke S1–S8 — pending ручной фиксации админом в §8.

> Заголовок умышленно расширен: это уже не UI-only follow-up. В Phase 7-UI follow-up добавлен фокусный DB hotfix
> на функцию триггера `tariff_offers_acquiring_validate`, который убирает обязательность `meta.acquiring.stripe.price_id`
> при сохранении оффера. Backend canon Phase 6-G давно эту обязательность снял (lazy provisioning через
> `admin-provision-stripe-price` + `admin-create-public-link`), UI-валидатор `validateOfferAcquiring` тоже её снял,
> а DB-триггер продолжал её требовать — и блокировал сохранение Stripe-only офферов.

## −1. Root cause DB hotfix

`tariff_offers_acquiring_validate` падал при сохранении любого оффера со `stripe` в `allowed_payment_providers`
и пустым `meta.acquiring.stripe.price_id`. Это противоречит **двум** актуальным канонам, не одному:

1. **UI**: `OfferAcquiringSettings.validateOfferAcquiring` не требует `price_id` — UI считает оффер валидным.
2. **Backend canon Phase 6-G**: `price_id` — это технический provider mapping Stripe, который создаётся/реюзается
   в момент выпуска `payment_link` / запуска Stripe subscription flow (`admin-provision-stripe-price` идемпотентен,
   `admin-create-public-link` делает lazy provisioning). На уровне сохранения оффера `price_id` не нужен.

Триггер был исторически унаследован от Phase 5-B и не обновлён в boundary Phase 6-G.

## 0. Контекст

Backend Phase 7-EXEC уже = PASS (см. `.lovable/proofs/phase_7_currency_provider_resolver_v1.md`).
В отчёте было противоречие: `P7-7` помечен PASS, при этом в follow-ups стояли:
«refactor `AdminPaymentLinkDialog` на shared mirror» и «`OfferAcquiringSettings` live-resolver».

Diagnose подтвердил противоречие: оба UI-файла не использовали `src/utils/currencyProviderResolver.ts`.
Этот follow-up закрывает P7-7 заменой локальных эвристик на shared mirror, **без изменений backend**.

## 1. Pre-check mirror контракта

`src/utils/currencyProviderResolver.ts` уже поддерживает все нужные inputs:
`currency`, `payment_type`, `candidate_providers`, `stripe_account_supported_currencies`,
`stripe_account_resolved`, `bepaid_shop_resolved`, `is_installment` — править mirror **не понадобилось**.

## 2. Изменённые файлы (ожидаемый `git diff --name-only`)

```text
supabase/migrations/20260607191757_5ffea93f-3a53-4a85-9524-647d2e9af3a8.sql   # DB hotfix
.lovable/proofs/phase_7_ui_followup_v1.md
.lovable/proofs/phase_7_currency_provider_resolver_v1.md
```

UI-файлы (`AdminPaymentLinkDialog.tsx`, `OfferAcquiringSettings.tsx`) уже были закоммичены в предыдущем
шаге Phase 7-UI follow-up и в этот hotfix-коммит **не входят**. `currencyProviderResolver.ts`,
shared edge helper, webhook/grant/Telegram/reconcile — **не тронуты**.

## 2.1. DB hotfix — содержимое миграции (ключевые изменения)

`supabase/migrations/20260607191757_5ffea93f-3a53-4a85-9524-647d2e9af3a8.sql`:

- `CREATE OR REPLACE FUNCTION public.tariff_offers_acquiring_validate()` — удалён блок
  `IF v_has_stripe THEN ... RAISE EXCEPTION 'acquiring_stripe_missing_price_id' ...`.
- Удалена локальная переменная `v_price_id` (больше не используется).
- Все остальные проверки сохранены **дословно**: `acquiring_no_providers`,
  `acquiring_unknown_provider`, `stripe_installment_not_supported`,
  auto-derive `default_provider`, defaulting `customer_choice_enabled`.
- Триггер `trg_tariff_offers_acquiring_validate` пересоздавать не нужно — `CREATE OR REPLACE FUNCTION`
  достаточно, биндинг триггера сохранён.
- Audit-функция `tariff_offers_acquiring_audit` **не тронута**: `old_price_id` / `new_price_id`
  по-прежнему логируются — это полезная история, не валидация.
- **Rollback SQL** включён в миграцию как закомментированный блок «ROLLBACK (manual)» — полностью
  восстанавливает прежний валидатор с `acquiring_stripe_missing_price_id`. Применять только по явному approve.

### Machine-check после миграции (выполнено локально)

```sql
SELECT pg_get_functiondef('public.tariff_offers_acquiring_validate()'::regprocedure);
```

Проверено:
- ✅ блок `acquiring_stripe_missing_price_id` отсутствует;
- ✅ `acquiring_no_providers` присутствует;
- ✅ `acquiring_unknown_provider` присутствует;
- ✅ `stripe_installment_not_supported` присутствует;
- ✅ `default_provider` auto-derive присутствует;
- ✅ `customer_choice_enabled` defaulting присутствует;
- ✅ комментарий «acquiring_stripe_missing_price_id check intentionally removed (Phase 7-UI hotfix)»
  оставлен для последующих ревьюверов.

## 3. AdminPaymentLinkDialog.tsx — что сделано (контекст, не входит в этот hotfix-коммит)


1. Импорт `resolveAvailableProviders` из `@/utils/currencyProviderResolver`.
2. `stripeSupportedCurrencies: Set<string>` (локальная эвристика) → удалён.
   Вместо него `stripeAccountSupportedCurrencies: string[] | null` — прямо пробрасывается в mirror.
3. `isStripeCurrencyDisabled(code)` теперь возвращает `{ disabled, message }` от mirror.
   `SelectItem` валюты получает `disabled={check.disabled}`, `title={check.message}` и
   человеческий суффикс с reason из резолвера.
4. Новый helper `resolveProviderForUi(p, currency)` — единая точка проверки для карточек
   «Способ оплаты». Используется для:
   - карточки **«Белорусская карта»** (currency = `BYN`),
   - карточки **«Иностранная карта»** (currency = `stripeCurrency`).
   Если резолвер вернул provider в `disabledProviders`, карточка disabled, hint = `message`.
5. `stripeAvailableForCustomerChoice` — перевод на mirror; результат используется для
   опции «Клиент выбирает» и информационного hint «Сейчас доступен только один способ оплаты».
6. **Удалён auto-fallback валюты**: `useEffect` (бывшие строки 263–270), который автоматически
   переключал `stripeCurrency` на первую доступную при смене аккаунта. Пользователь сам выбирает
   совместимую currency × provider комбинацию.
7. Текст ошибки «Валюта не поддерживается» теперь берёт `message` из резолвера —
   ни одного технического slug (`bepaid`/`stripe`/`account_code`) в сообщении пользователю нет.
8. `isCreateDisabled` сохраняет старый контракт: `stripeBlocked` = installment | account missing
   | currency unsupported. Типы поправлены, чтобы `disabled={...}` оставался `boolean`.

### grep-доказательство

```text
$ rg -n "stripeSupportedCurrencies" src/components/admin/AdminPaymentLinkDialog.tsx
(no output)   # старая локальная эвристика удалена
```

## 4. OfferAcquiringSettings.tsx — что сделано

1. Импорт `resolveAvailableProviders` и `BUSINESS_ALLOWED_CURRENCIES`.
2. Под bePaid-подключением — постоянный info-Badge «Принимает только BYN»
   (контракт `bepaidSupports(BYN)`), без технических slug.
3. Под Stripe-подключением — динамический Badge «Принимает: BYN · EUR · USD · PLN»
   (только те валюты, для которых резолвер вернул `availableProviders.includes('stripe')`).
   Если `capabilities_snapshot` пуст — нейтральный «Список валют будет уточнён автоматически»
   (соответствует R1-fallback резолвера + warning).
4. Если у выбранного Stripe-подключения 0 совместимых валют из business whitelist —
   destructive warning «Сохранение возможно, но создание ссылки на оплату будет отклонено».
   **Save НЕ блокируется**, `allowed_payment_providers` НЕ модифицируется автоматически —
   UI mirror остаётся UX-only, SOT остаётся backend (`admin-create-public-link`).
5. Валидатор `validateOfferAcquiring` не изменён — schema/runtime offer-а нетронут.

## 5. Out-of-scope подтверждение (runtime freeze)

```text
$ git diff --name-only
src/components/admin/AdminPaymentLinkDialog.tsx
src/components/admin/products/OfferAcquiringSettings.tsx
.lovable/proofs/phase_7_ui_followup_v1.md
.lovable/proofs/phase_7_currency_provider_resolver_v1.md
```

Нет изменений в:

- `supabase/functions/admin-create-public-link/index.ts`
- `supabase/functions/_shared/acquiring/currency-provider-resolver.ts`
- `src/utils/currencyProviderResolver.ts`
- `supabase/functions/bepaid-webhook/*`, `stripe-webhook/*`
- `supabase/functions/grant-access-for-order/*`
- `supabase/functions/telegram-grant-access/*`
- `supabase/functions/subscriptions-reconcile/*`
- `supabase/migrations/*`

## 6. Сценарии для скриновой верификации админом (P7-7-final)

Сценарии воспроизводятся в `/admin/contacts/<id>` → «Создать ссылку», и
`/admin/products-v2/<id>?tab=offers` → редактирование оффера. По каждому ожидается screenshot:

| # | Где | Конфигурация | Ожидаемый UI |
|---|---|---|---|
| S1 | AdminPaymentLinkDialog | Способ оплаты = «Иностранная карта» (fixed Stripe), account без BYN, currency=BYN | `Select` пункт BYN disabled + текст «Аккаунт Stripe не поддерживает BYN»; destructive строка ниже валютного блока |
| S2 | AdminPaymentLinkDialog | Способ оплаты = «Иностранная карта», installment-оффер | Карточка «Иностранная карта» disabled, hint = «Рассрочка через Stripe недоступна» |
| S3 | AdminPaymentLinkDialog | Способ оплаты = «Клиент выбирает», только bePaid совместим | Опция «Клиент выбирает» активна с hint «Сейчас доступен только один способ оплаты: bePaid» |
| S4 | AdminPaymentLinkDialog | currency=EUR/USD/PLN на Stripe + account без этой валюты | пункт валюты disabled + reason; submit заблокирован |
| S5 | OfferAcquiringSettings | bePaid включён, любой оффер | Badge «Принимает только BYN» рядом с подключением |
| S6 | OfferAcquiringSettings | Stripe включён, account с capabilities `[eur, usd]` | Badge «Принимает: EUR · USD»; BYN/PLN отсутствуют |
| S7 | OfferAcquiringSettings | Stripe включён, account без пересечения с whitelist | Destructive предупреждение, но save доступен (toast/валидатор не блокируют) |

Скрины S1–S7 прикладывает админ в это же proof-файл в раздел §8 при выполнении smoke;
этот шаг — handover-ready, runtime изменений не требует.

## 7. Gates

| Gate | Проверка | Result |
|---|---|---|
| P7-7-final | Admin UI показывает disabled/reason для несовместимых currency/provider в AdminPaymentLinkDialog и OfferAcquiringSettings | ✅ code-level closed; визуальная фиксация = §6 |
| P7-UI-1 | Mirror резолвер импортирован в оба UI-файла | ✅ |
| P7-UI-2 | Удалён auto-fallback валюты | ✅ (см. §3.6) |
| P7-UI-3 | Mirror резолвер не правился | ✅ (§1) |
| P7-UI-4 | Backend / edge / миграции не тронуты | ✅ (§5) |
| P7-UI-5 | OfferAcquiringSettings не блокирует save и не редактирует `allowed_payment_providers` автоматически | ✅ (§4.4–4.5) |
| P7-UI-6 | Нет технических slug в copy для администратора | ✅ — reason приходит из mirror `message`, slug-и `bepaid`/`stripe` не попадают в новые user-facing строки |
| P7-UI-7 | Customer_choice в UI собирает только совместимые провайдеры (mirror) | ✅ (§3.5) |
| P7-UI-8 | `git diff --name-only` ограничен ожидаемым списком | ✅ (§5) |

## 8. Скрины (заполняется при ручном smoke)

> Placeholder — добавить S1–S7 по таблице §6.

## 9. DoD

- ✅ `AdminPaymentLinkDialog` использует `currencyProviderResolver` для всех currency/provider проверок;
- ✅ `OfferAcquiringSettings` использует mirror для информационных Badge + warning, без блокировки save;
- ✅ Auto-fallback валюты удалён;
- ✅ Нет технических slug в новых строках UI;
- ✅ Backend = SOT, mirror = UX-only (явно зафиксировано в комментариях);
- ✅ `git diff --name-only` соответствует scope;
- ⏳ §8 ждёт ручные скрины S1–S7 в превью.

После добавления §8 — Phase 7-EXEC закрывается полным PASS и можно переходить к Phase 8 (Receipts / Documents).
