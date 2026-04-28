# План: тип кнопки «Рассрочка» с выбираемым сроком 2–N месяцев + публичные ссылки на рассрочку

## 0. Что уже есть и НЕ ломаем

- `tariff_offers.offer_type ∈ {pay_now, trial, preregistration}` — назначение оффера. CHECK не трогаем.
- `tariff_offers.payment_method ∈ {full_payment, internal_installment, …}` — способ оплаты внутри pay_now. `direct-charge` + `_shared/installment-schedule.ts` уже создают `installment_payments`. `installment-charge-cron` и `installment-notifications` готовы (Stage 4, runtime-proof открыт до первого cron-запуска).
- В `AdminProductDetailV2` уже есть UI для `payment_method='internal_installment'` и `installment_count`, но привязан к старой модели «фиксированное число платежей».
- `admin-create-public-link` → `public-checkout` → `_shared/create-payment-checkout.ts` → `bepaid-webhook` (ветка `WEBHOOK-LINK-ORDER`) — каноническая цепочка для public links. Расширяем её, второй payment-path не вводим.

**Контракт фичи (single source of truth):**
> Кнопка «Рассрочка» = `offer_type='pay_now' + payment_method='internal_installment'`. В кнопке хранится **максимальный** срок (`max_months ∈ [2..12]`), фиксированный интервал 30 дней и `first_payment_delay_days=0`. Реальное количество платежей выбирает плательщик/админ из `[2..max]`, и оно попадает в `installment_count` экземпляра.

**Бизнес-правило округления (зафиксировано):**
- per-payment = **round half-up** от `total/N` до целых BYN.
- Итог рассрочки = `per_payment × N`, может отличаться от полной цены в большую или меньшую сторону.
- Это допустимо: цена фиксируется с учётом выбранного срока. UI ОБЯЗАН показывать ИТОГО.

---

## Stage L0 — Read-only proof (обязателен ДО патча)

По ссылке `872b0603a4c47b8ce29f8d97370a2547` и офферу «2 этапа»:
1. `tariff_offers`: `payment_method`, `installment_count`, `installment_interval_days`, `first_payment_delay_days`, `meta`.
2. `payment_links`: `payment_type`, `offer_id`, `meta`, `amount`.
3. `orders_v2` по `meta.payment_link_id`, `installment_payments` по `order_id`, `audit_logs` `payment_link.created`.

Snapshot → `.lovable/proofs/installment_link_baseline.txt`. Без него L1 не запускаем.

---

## Stage L0a — Модель кнопки «Рассрочка» (без миграций схемы)

**Решения:**
- НЕ вводим `offer_type='installment'`. UI-«4-й тип» = комбинация `pay_now + internal_installment`. CHECK не трогаем, новых колонок не добавляем.
- В `tariff_offers.meta` добавляем подобъект:
  ```
  meta.installment = {
    max_months: 2..12,
    interval_days: 30,
    first_payment_delay_days: 0,
    rounding_mode: 'round_half_up_byn'
  }
  ```
- Legacy-зеркало: writer пишет `installment_count = max_months`, `installment_interval_days = 30`, `first_payment_delay_days = 0` в существующие колонки. Это сохраняет работу `direct-charge`, `installment-charge-cron`, отчётов до полного перехода.

### L0a-1 — `AdminProductDetailV2.tsx` (форма оффера)

Dropdown «Тип кнопки» — 4 варианта:
1. Оплата полной стоимости — `pay_now + full_payment`
2. Trial — `trial`
3. Предзапись — `preregistration`
4. **Рассрочка** — `pay_now + internal_installment`

При выборе «Рассрочка»:
- Поле «Сумма» = полная стоимость тарифа.
- Новое поле **«Максимальный срок рассрочки, мес»** — stepper +/− 2..12, default 6. → `meta.installment.max_months`.
- Поля «Интервал» и «Задержка первого платежа» **скрыты в UI**, фиксированы кодом 30 и 0.
- `requires_card_tokenization=true` форсится автоматически.
- `is_primary` разрешён.
- Подсказка (RU): «Клиент при оплате выберет срок от 2 до N месяцев. Сумма будет списываться равными платежами раз в 30 дней. Первый платёж — сразу при покупке.»

Сохранение: `payment_method='internal_installment'`, `meta.installment={max_months, interval_days:30, first_payment_delay_days:0, rounding_mode:'round_half_up_byn'}`, legacy-зеркало.

### L0a-2 — `OfferRowCompact.tsx`, `TariffCardCompact.tsx`

Распознаём installment, бейдж «Рассрочка до N мес.» (RU), отдельный variant.

DoD L0a: создание/редактирование с `max_months ∈ [2..12]` сохраняется в `meta.installment` + legacy. Существующие installment-офферы продолжают работать после L0b.

---

## Stage L0b — Бэкфилл существующих installment-офферов (data-only, не миграция)

Через insert-tool (UPDATE) для всех `payment_method='internal_installment' AND meta->'installment' IS NULL`:
- `meta.installment.max_months = installment_count`
- `meta.installment.interval_days = COALESCE(installment_interval_days, 30)`
- `meta.installment.first_payment_delay_days = COALESCE(first_payment_delay_days, 0)`
- `meta.installment.rounding_mode = 'round_half_up_byn'`

DoD: SELECT возвращает 0 строк с `internal_installment AND meta->'installment' IS NULL`.

---

## Stage L1 — Выбор срока в UI плательщика и админа

### L1.1 — Карточка контакта `AdminPaymentLinkDialog.tsx`

- Хелпер `offerKind(offer)` → `installment` | `subscription` | `one_time`.
- Если `installment`:
  - Скрыть ToggleGroup `one_time/subscription`, показать read-only бейдж «Рассрочка».
  - **Dropdown «Срок рассрочки»** опции `2..max_months` (`offer.meta.installment.max_months` ?? `offer.installment_count`). Default = `max_months`.
  - Подсказка для админа (RU): «Выберите, на сколько месяцев создать рассрочку для клиента.»
  - **Полный UI-блок суммы:**
    ```
    N платежей × X BYN = ИТОГО Y BYN
    Сумма платежа округлена до целых BYN. Итог рассрочки рассчитан с учётом выбранного срока и может отличаться от полной цены.
    ```
    `X = round_half_up(total / N)`, `Y = X * N`.
  - Override-режим (превратить в one_time/subscription) запрещён.
- Payload в `admin-create-public-link`: `installment_offer:true`, `selected_installment_months:N`. Никаких сумм с фронта.

### L1.2 — `Pay.tsx` + `public-checkout` GET-info

- Если `link.meta.installment`:
  - Dropdown «Срок рассрочки» 2..max. Default = `max`.
  - Текст для клиента (RU): «Выберите срок рассрочки. Сумма будет разделена на выбранное количество ежемесячных платежей. Списание происходит каждые 30 дней. Рассрочка является подпиской с ограниченным количеством платежей.»
  - Тот же полный UI-блок: `N × X = ИТОГО Y` + пояснение про округление.
- На submit POST → `public-checkout` `selected_installment_months: N`. Авторитет — сервер.

DoD L1: для `max_months=6` доступны 2..6 (7+ невозможен) на обеих площадках. Для `max_months=12` — 2..12. UI показывает корректный ИТОГО.

---

## Stage L2 — Writer `admin-create-public-link`

Файл: `supabase/functions/admin-create-public-link/index.ts`.

1. Принимаем `installment_offer:boolean`, `selected_installment_months:number`.
2. После валидации `offer_id`:
   - перечитываем offer, проверяем `payment_method='internal_installment'`,
   - `max_months = offer.meta?.installment?.max_months ?? offer.installment_count`,
   - валидируем `Number.isInteger(selected) && 2 ≤ selected ≤ max_months` → иначе `400 invalid_installment_months`.
3. Расчёт сумм:
   - `total_byn = amount_kopecks / 100` (UI шлёт полную стоимость).
   - `per_payment_byn = Math.round(total_byn / selected)` (round half-up, целые BYN).
   - `per_payment_kopecks = per_payment_byn * 100`.
   - `total_installment_byn = per_payment_byn * selected`.
4. INSERT `payment_links`:
   - `payment_type='one_time'`,
   - `amount = per_payment_kopecks` (сумма ПЕРВОГО bePaid checkout),
   - `meta.installment`:
     ```
     {
       payment_method: 'internal_installment',
       max_installment_months: <max>,
       selected_installment_months: <selected>,
       interval_days: 30,
       first_payment_delay_days: 0,
       total_amount: <total_byn>,
       per_payment_amount: <per_payment_byn>,
       total_installment_amount: <total_installment_byn>,
       rounding_mode: 'round_half_up_byn'
     }
     ```
5. Audit `payment_link.created`: + `installment:true, selected_installment_months, max_installment_months, per_payment_amount, total_installment_amount`.

DoD L2: для `total=200, selected=3` → `per_payment=67`, `link.amount=6700`, `total_installment=201`.

---

## Stage L3 — Public-checkout → order → webhook

### 3.1 `public-checkout/index.ts`

- Принимаем optional `selected_installment_months`. Если link installment: `2..link.meta.installment.max_installment_months`. Default = `link.meta.installment.selected_installment_months`. 400 при выходе за границы.
- Per-payment пересчитываем сервером: `Math.round(link.meta.installment.total_amount / effective_selected)`.
- В `createPaymentCheckout` → `meta_extra`:
  ```
  {
    payment_link_id: link.id,
    is_installment: true,
    installment_offer_id: link.offer_id,
    installment_count: <effective_selected>,
    installment_interval_days: 30,
    first_payment_delay_days: 0,
    installment_total_amount_byn: <per_payment * selected>,
    installment_per_payment_amount_byn: <per_payment>
  }
  ```
- `payment_type='one_time'`, amount → bePaid = `per_payment_kopecks`.

### 3.2 `_shared/create-payment-checkout.ts`

В ветке one_time копируем `is_installment` + `installment_*` из `meta_extra` в `orders_v2.meta`. Сам checkout-запрос к bePaid не меняется.

### 3.3 `bepaid-webhook` ветка `WEBHOOK-LINK-ORDER`

После `grant-access-for-order`, если `linkOrder.meta.is_installment === true`:
1. Загружаем offer по `installment_offer_id`/`linkOrder.offer_id`.
2. Эффективный offer для `generateInstallmentSchedule`:
   ```
   {
     id: offer.id,
     payment_method: 'internal_installment',
     installment_count: linkOrder.meta.installment_count, // ← из order, не offer
     installment_interval_days: 30,
     first_payment_delay_days: 0,
   }
   ```
3. `totalAmount = linkOrder.meta.installment_total_amount_byn` (= per_payment×N → все строки одинаковые).
4. `generateInstallmentSchedule(...)` с `subscription = grantedSubscriptionV2Id` (или fallback-lookup), `firstPayment.paymentId = payment.id`.

Все ошибки non-fatal с audit (как у соседних шагов).

DoD L3: оплата по installment-ссылке `selected=3` создаёт **ровно 3** строки `installment_payments` (1 succeeded + 2 pending), все по 67 BYN. UNIQUE `(order_id, payment_number)` гарантирует идемпотентность.

---

## Stage L4 — Контракт суммы (round half-up)

- `per_payment = Math.round(total / selected)` BYN, целые BYN (round half-up).
- `total_installment = per_payment * selected` (может > или < total).
- `payment_links.amount = per_payment * 100` — сумма ПЕРВОГО checkout.
- В `installment_payments` все N платежей одинаковой суммой `per_payment`. Хелперу передаём `totalAmount = per_payment * N`, чтобы внутреннее деление дало ровно `per_payment` без копеечных артефактов.

DoD L4 (примеры):
- `total=200, N=3` → 3×67=201
- `total=200, N=4` → 4×50=200
- `total=199, N=4` → 4×50=200
- `total=99,  N=2` → 2×50=100

---

## Stage L5 — Журнал ссылок: бейдж «Рассрочка»

- `LinksTabContent.tsx`, `LinkDetailsDrawer.tsx`. View `payment_links_enriched_v` НЕ трогаем (читаем `meta`).
- Helper: `link.meta?.payment_method === 'internal_installment'` → бейдж «Рассрочка N мес.» (RU).
- В деталях: «Полная цена тарифа: total / N платежей по X BYN / ИТОГО Y BYN / Списание раз в 30 дней».

---

## Stage L6 — Verify (runtime proof)

1. В админке создать кнопку «Рассрочка» в тарифе с `max_months=6`.
2. Из карточки контакта выбрать кнопку, `selected=3`, создать ссылку.
3. Открыть `/pay/:token`, проверить dropdown 2..6, ИТОГО, оплатить тестовой картой.
4. SQL-proof:
   - `payment_links.meta.installment.selected_installment_months=3, max=6, per_payment=67, total_installment=201`.
   - `orders_v2.meta`: `is_installment=true, installment_count=3, installment_per_payment_amount_byn=67`.
   - `installment_payments`: ровно 3 строки, payment_number 1..3, amount=67 у всех, 1=succeeded, 2-3=pending, due_date 2 = first+30д, 3 = first+60д.
   - `audit_logs`: `payment_link.created`(installment:true, selected:3, max:6), `installment_started`(count=3).
   - `subscriptions_v2`: одна активная.
5. Граничные:
   - POST `selected=7` при max=6 → 400.
   - POST `selected=1` → 400.
   - Повторный webhook → нет дублей.
6. После cron-списания всех 3 платежей: 4-й невозможен; cron не создаёт новых строк.

→ `.lovable/proofs/installment_link_runtime.txt`.

---

## Stage L7 — DoD общий

- `max_months=6` ⇒ выбор 7..12 невозможен везде (UI карточки, `/pay`, серверная валидация POST).
- `max_months=12` ⇒ доступны 2..12.
- `selected=N` ⇒ ровно N строк `installment_payments`, лишних списаний нет.
- После N-го платежа рассрочка завершается; `subscriptions_v2.access_end_at` живёт по правилам тарифа.
- Существующие installment-офферы (после L0b) работают в `direct-charge` без регрессов.
- UI везде показывает ИТОГО Y BYN с пояснением про округление.

---

## Anti-scope

- Не вводим `offer_type='installment'`.
- Не добавляем колонок в `tariff_offers`/`payment_links`.
- Не пишем новый writer/checkout/webhook — только расширение существующих.
- `direct-charge` с выбором срока — backlog `PAY-installment-direct-charge-month-picker`.
- TG-уведомления — backlog `PAY-installment-notify-TG`.
- Email-унификация — backlog `PAY-installment-email-unification` (priority **high**).
- Рассрочка без кнопки — backlog `PAY-installment-adhoc-link`.

---

## Контракт (SoT)

| Решение | Источник истины |
|---|---|
| Признак installment-кнопки | `tariff_offers.payment_method='internal_installment'` |
| Максимальный срок | `tariff_offers.meta.installment.max_months` (legacy: `installment_count`) |
| Интервал | фиксированно 30 дней |
| Задержка первого платежа | фиксированно 0 |
| Срок per-link | `payment_links.meta.installment.selected_installment_months` |
| Срок per-order | `orders_v2.meta.installment_count` |
| Per-payment | `Math.round(total / selected)` BYN, round half-up |
| Total installment | `per_payment * selected` (может ≠ total) |
| Создание `installment_payments` | только `_shared/installment-schedule.ts` |
| Выдача доступа | только `grant-access-for-order` |
| Cron / уведомления | без изменений |

---

## Backlog (открытые пункты от Stage 4 — НЕ блокирующие L)

- **PAY-installment-notify-TG** — Telegram-уведомления о платежах рассрочки. Priority: medium.
- **PAY-installment-email-unification** — перевод `installment-notifications` на общий `send-transactional-email` для единого proof/logging. Priority: **high** (без него нет единого email-логирования).
- **Stage 4 runtime-proof** — открыт до первого реального cron-запуска `installment-charge-cron`. Технически принят, runtime-proof отдельно.
