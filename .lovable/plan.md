да, согласен, с учетом правок:

1. Зафиксировать: **кнопка “Рассрочка” = отдельный тип в UI**, но технически без нового offer_type:  
offer_type='pay_now' + payment_method='internal_installment'.
2. Добавить в DoD:  
администратор при создании кнопки задаёт **максимальный срок рассрочки 2–12 месяцев**, а клиент/админ при оплате выбирает срок только в этих пределах.
3. Уточнить текст для клиента:

Рассрочка — это оплата частями. Первый платёж списывается сразу, остальные — каждые 30 дней. Количество платежей ограничено выбранным сроком.

4. Уточнить важное: если используется floor(total/N), итоговая сумма может быть меньше полной цены. Это должно быть явно принято как бизнес-правило. Если нет — остаток лучше добавлять в первый платёж.

&nbsp;

да, согласен, с учетом правок:

Добавить решение по округлению:

Округление суммы рассрочки принимается как бизнес-правило.

&nbsp;

Если полная стоимость не делится ровно на выбранное количество платежей, сумма одного платежа округляется до целых BYN. Итоговая сумма рассрочки может отличаться от полной стоимости тарифа в большую или меньшую сторону. Это допустимо, так как цена фиксируется с учётом выбранного срока рассрочки.

&nbsp;

В UI обязательно показывать:

- количество платежей;

- сумму одного платежа;

- итоговую сумму рассрочки;

- пояснение, что итоговая сумма рассчитана с учётом выбранного срока.

В DoD добавить:

Для total=200 BYN и selected=3 система показывает 3 платежа по округлённой сумме и итоговую сумму рассрочки. Пользователь видит итог до оплаты.

## План: тип кнопки «Рассрочка» с выбираемым сроком 2–N месяцев + публичные ссылки на рассрочку (без новых параллельных функций)

### 0. Что уже есть и НЕ ломаем

- `tariff_offers.offer_type ∈ {pay_now, trial, preregistration}` — это **назначение оффера**.
- `tariff_offers.payment_method ∈ {full_payment, internal_installment, …}` — это **способ оплаты внутри pay_now**. Уже работает: `direct-charge` читает `installment_count`, `installment_interval_days`, `first_payment_delay_days`, `amount` и через `_shared/installment-schedule.ts` создаёт `installment_payments`. `installment-charge-cron` и `installment-notifications` — уже завершены.
- В UI редактора оффера (`AdminProductDetailV2`) уже есть `payment_method` и `installment_count`, но они привязаны к старой модели «фиксированное число платежей».
- `admin-create-public-link` + `public-checkout` + `_shared/create-payment-checkout.ts` + `bepaid-webhook` (ветка WEBHOOK-LINK-ORDER) — **существующая** канонная цепочка для public links. Расширяем её, второй payment-path не вводим.

**Контракт всей фичи (single source of truth):**

> Кнопка «Рассрочка» = `offer_type='pay_now' + payment_method='internal_installment'`. В кнопке хранится **максимальный** срок рассрочки (`max_installment_months`), фиксированный интервал 30 дней и `first_payment_delay_days=0`. Реальное количество платежей выбирает плательщик (или админ при создании ссылки) в пределах [2 .. max], и оно попадает в `installment_count` конкретного экземпляра расписания.

---

### Stage L0 — Read-only proof (обязателен ДО патча)

По ссылке `872b0603a4c47b8ce29f8d97370a2547` и офферу «2 этапа»:

1. `tariff_offers`: `payment_method`, `installment_count`, `installment_interval_days`, `first_payment_delay_days`, `meta`.
2. `payment_links`: `payment_type`, `offer_id`, `meta`, `amount`.
3. `orders_v2` по `meta.payment_link_id`, `installment_payments` по `order_id`, `audit_logs payment_link.created`.

DoD L0: snapshot в `.lovable/proofs/installment_link_baseline.txt`. Без него L1 не запускаем.

---

### Stage L0a — Модель кнопки «Рассрочка» (схема и редактор кнопки)

**Решения по схеме (минимально-инвазивно):**

- НЕ вводим новый `offer_type='installment'` — UI-«4-й тип» получается из комбинации `offer_type='pay_now' + payment_method='internal_installment'`. CHECK не трогаем.
- В существующее поле `tariff_offers.meta` (jsonb) добавляем подобъект:
  ```
  meta.installment = {
    max_months: 2..12,
    interval_days: 30,
    first_payment_delay_days: 0,
    rounding_mode: 'floor_byn'
  }
  ```
  Никаких новых колонок. `installment_count` / `installment_interval_days` / `first_payment_delay_days` остаются как **legacy-зеркало для обратной совместимости**: writer (см. ниже) при сохранении кнопки записывает туда `installment_count = max_months`, `installment_interval_days = 30`, `first_payment_delay_days = 0`. Это сохраняет работу `direct-charge`, `installment-charge-cron`, отчётов до полного перехода.

**Stage L0a-1 — Редактор оффера в `AdminProductDetailV2.tsx` (+ форма):**

В выпадающем списке «Тип кнопки» (сейчас он подсказывается через `payment_method`/`offer_type`) показать 4 варианта в одном dropdown:

1. Оплата полной стоимости — `offer_type=pay_now, payment_method=full_payment`
2. Trial — `offer_type=trial`
3. Предзапись — `offer_type=preregistration`
4. **Рассрочка** — `offer_type=pay_now, payment_method=internal_installment`

При выборе «Рассрочка»:

- Поле «Сумма» = полная стоимость тарифа (как сейчас).
- Новое поле **«Максимальный срок рассрочки, мес»** — stepper +/− со значениями 2..12, default 6. Сохраняется в `meta.installment.max_months`.
- Поля «Интервал списания» и «Задержка первого платежа» **скрыты** в UI и фиксированы кодом: 30 и 0. (Поля БД остаются, но писать только эти значения.)
- `requires_card_tokenization=true` форсится автоматически (уже так в `AdminProductDetailV2` lines 637).
- `is_primary` разрешён.
- Поясняющий текст под полем (RU): «Клиент при оплате выберет срок от 2 до N месяцев. Сумма будет списываться равными платежами раз в 30 дней. Первый платёж — сразу при покупке.»

Сохранение оффера (handler уже есть, lines 566+):

- Если выбран «Рассрочка»: `payment_method='internal_installment'`, `meta.installment={max_months, interval_days:30, first_payment_delay_days:0, rounding_mode:'floor_byn'}`, **legacy-зеркало** `installment_count=max_months`, `installment_interval_days=30`, `first_payment_delay_days=0`.

**Stage L0a-2 — Карточка/строка оффера (`OfferRowCompact.tsx`, `TariffCardCompact.tsx`):**

- Добавить распознавание installment-кнопки и бейдж «Рассрочка до N мес.» (RU). Иконка/цвет — отличить от `pay_now`/`trial`/`preregistration` (используем существующие variants, без новых компонентов).

DoD L0a: можно создать/отредактировать кнопку «Рассрочка» с `max_months ∈ [2..12]`, она корректно отображается в админке и сохраняется в `tariff_offers.meta.installment` + legacy-полях. Существующие installment-офферы продолжают работать (миграция данных не нужна, см. L0b).

---

### Stage L0b — Бэкфилл существующих installment-офферов (data-only, не миграция)

Для всех офферов с `payment_method='internal_installment'`, у которых `meta.installment IS NULL`:

- `meta.installment.max_months = installment_count` (фиксируем как «сколько и было»),
- `meta.installment.interval_days = COALESCE(installment_interval_days, 30)`,
- `meta.installment.first_payment_delay_days = COALESCE(first_payment_delay_days, 0)`,
- `meta.installment.rounding_mode = 'floor_byn'`.

Делается через insert-tool (UPDATE), не через миграцию. DoD: SELECT-ом подтверждаем 0 офферов с `payment_method='internal_installment' AND meta->'installment' IS NULL`.

---

### Stage L1 — Выбор срока рассрочки в UI плательщика и админа

**L1.1 — Карточка контакта `AdminPaymentLinkDialog.tsx`:**

- Хелпер `offerKind(offer)`:
  - `installment` если `payment_method='internal_installment'`,
  - `subscription` если `meta.recurring.is_recurring`,
  - иначе `one_time`.
- Если `effectiveOffer.kind === 'installment'`:
  - Скрыть ToggleGroup `one_time/subscription` (для рассрочки он не имеет смысла), показать read-only бейдж «Рассрочка».
  - Показать **dropdown «Срок рассрочки»** с опциями `2..max_months` (из `offer.meta.installment.max_months`, fallback на legacy `installment_count`). Default = `max_months`.
  - Под dropdown текст для админа (RU): «Выберите, на сколько месяцев создать рассрочку для клиента.»
  - Превью: «N платежей по X BYN», где `X = floor(totalAmount / N)` (целые BYN, без копеек).
  - Override-режим (превратить рассрочку в обычный one_time/subscription) **запрещён** — это коммерчески другой контракт, для этого редактируется сама кнопка.
- В payload в `admin-create-public-link` для installment-кнопок:
  - `installment_offer: true`
  - `selected_installment_months: <N>` (число в [2..max])
  - Никаких сумм/интервалов с фронта — writer пересчитывает сам по `offer_id`.

**L1.2 — Публичная страница оплаты `/pay/:token` (`Pay.tsx` / `public-checkout` GET-info):**

- Если link представляет рассрочку (`meta.payment_method='internal_installment'`):
  - Dropdown «Срок рассрочки» с опциями `2..max_installment_months`. Default = `max_installment_months`.
  - Текст для клиента (RU): «Выберите срок рассрочки. Сумма будет разделена на выбранное количество ежемесячных платежей. Списание происходит каждые 30 дней. Рассрочка является подпиской с ограниченным количеством платежей.»
  - Превью: «N платежей по X BYN». X считается клиентом так же, как сервером (`floor(total / N)`), для отображения; авторитет — сервер.
- На submit POST в `public-checkout` передаётся `selected_installment_months: N`.

DoD L1: 

- В карточке контакта и на `/pay/:token` для оффера с `max_months=6` доступен выбор 2..6 (7+ невозможен).
- Для оффера с `max_months=12` доступен 2..12.
- Превью суммы корректно: `total / N` округлено вниз до целого BYN.

---

### Stage L2 — Writer `admin-create-public-link`: сохранить выбранный срок (STOP-guard выполнен — без новых колонок)

Файл: `supabase/functions/admin-create-public-link/index.ts`.

Изменения:

1. Принимаем `installment_offer: boolean`, `selected_installment_months: number` (только если installment).
2. После валидации `offer_id` (lines 109–120):
  - перечитываем offer и проверяем `payment_method='internal_installment'`,
  - `max_months = offer.meta?.installment?.max_months ?? offer.installment_count` (fallback на legacy),
  - валидируем: `Number.isInteger(selected_installment_months) && 2 ≤ selected ≤ max_months`. Иначе `400 invalid_installment_months`.
  - `interval_days = offer.meta?.installment?.interval_days ?? offer.installment_interval_days ?? 30` — должен быть `=30`.
  - `first_payment_delay_days = 0`.
3. Расчёт сумм (см. L4):
  - `total_byn = amount_kopecks / 100` (входящий `amount` от UI = полная стоимость в копейках).
  - `per_payment_byn = Math.floor(total_byn / selected)` (целые BYN, без копеек, **floor**).
  - `per_payment_kopecks = per_payment_byn * 100`.
4. INSERT в `payment_links`:
  - `payment_type = 'one_time'` (вариант A, view не ломается),
  - `amount = per_payment_kopecks` (это сумма ПЕРВОГО списания через bePaid),
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
      rounding_mode: 'floor_byn'
    }
    ```
5. Audit `payment_link.created` дополняется `installment: true`, `selected_installment_months`, `max_installment_months`.

DoD L2: ссылка для оффера «2 этапа» (для теста — admin-edit повышает max_months до 6, выбираем 3) создаётся с `meta.installment.selected_installment_months=3`, `amount = floor(total/3)*100`.

---

### Stage L3 — Public-checkout: пробросить выбранный срок до order

Файлы: `supabase/functions/public-checkout/index.ts`, `_shared/create-payment-checkout.ts`, `bepaid-webhook/index.ts`.

**3.1 `public-checkout`:**

- В POST принимаем опциональный `selected_installment_months` от клиента.
- Защита: если link installment — клиентское значение должно быть `2..link.meta.installment.max_installment_months`. Если клиент не передал — берём `link.meta.installment.selected_installment_months` (default = max). Никогда не больше max.
- В `createPaymentCheckout` пробрасываем `meta_extra`:
  ```
  meta_extra: {
    payment_link_id: link.id,
    ...(installment ? {
      is_installment: true,
      installment_offer_id: link.offer_id,
      installment_count: <effective_selected>,   // авторитет — сервер
      installment_interval_days: 30,
      first_payment_delay_days: 0,
      installment_total_amount_byn: link.meta.installment.total_amount,
      installment_per_payment_amount_byn: link.meta.installment.per_payment_amount
    } : {})
  }
  ```
- `payment_type` остаётся `one_time`. amount, что уйдёт в bePaid = `link.amount` (per-payment копейки).

**3.2 `_shared/create-payment-checkout.ts`:**

- В ветке `one_time` копируем `is_installment`, `installment_*` ключи из `meta_extra` в `orders_v2.meta` без логики (как уже делается с `payment_link_id`). Сам checkout-запрос к bePaid не меняется (списывается per_payment, как и должно быть для первого платежа рассрочки).

**3.3 `bepaid-webhook` ветка `WEBHOOK-LINK-ORDER` (после `grant-access-for-order`, ~lines 2515–2522):**

- Если `linkOrder.meta.is_installment === true`:
  1. Загружаем offer по `linkOrder.meta.installment_offer_id` (или `linkOrder.offer_id`).
  2. Готовим адаптированный «эффективный offer» для `generateInstallmentSchedule`:
    ```
     effectiveOffer = {
       id: offer.id,
       payment_method: 'internal_installment',
       installment_count: linkOrder.meta.installment_count,        // ← из order, НЕ из offer
       installment_interval_days: 30,
       first_payment_delay_days: 0,
     }
    ```
  3. `totalAmount = linkOrder.meta.installment_total_amount_byn`.
  4. Зовём `generateInstallmentSchedule(...)` с `subscription = grantedSubscriptionV2Id` (или fallback-lookup — он уже есть в lines 2525–2543), `firstPayment.paymentId = payment.id`.
- Все ошибки — non-fatal с audit (как в остальных шагах ветки).

DoD L3: оплата по installment-ссылке с `selected=3` создаёт **ровно 3** строки `installment_payments` (1 succeeded + 2 pending), `total_payments=3`, audit `installment_started` с `installment_count=3`. Если на ту же ссылку пришёл бы webhook повторно — UNIQUE `(order_id, payment_number)` гарантирует идемпотентность.

---

### Stage L4 — Контракт суммы (заменяет старую фиксированную логику)

Принципы:

- **Полная стоимость** = `tariff_offer.amount` (берётся из кнопки, как сейчас).
- **Per-payment** = `floor(total / selected_installment_months)` BYN, **без копеек**.
- В `payment_links.amount` пишем `per_payment * 100` (kopecks). Это сумма ПЕРВОГО bePaid checkout.
- `installment_payments`: все N платежей одинаковой суммой `per_payment` (текущий хелпер `installment-schedule.ts` уже делит totalAmount на count, но он делает rounding до 2 знаков. **Правка:** в этой ветке передаём `totalAmount = per_payment * count` (а не исходный total), чтобы сумма всех платежей == чистый total после floor; «остаток» от исходной цены безвозвратно отбрасывается — это и есть `floor_byn` контракт). Альтернатива «остаток в первый/последний платёж» отвергается ради простоты UX «ровно X BYN каждый месяц».

DoD L4: для total=200 BYN, selected=3 → per_payment=66 BYN, 3 платежа по 66 BYN, итог 198 BYN. Никаких копеек в суммах installment_payments.

---

### Stage L5 — Журнал ссылок: бейдж «Рассрочка»

Файлы: `LinksTabContent.tsx`, `LinkDetailsDrawer.tsx`. View `payment_links_enriched_v` НЕ трогаем (читаем `meta`).

- Helper: `link.meta?.payment_method === 'internal_installment'` → бейдж «Рассрочка N мес.» (RU), показываем `selected_installment_months`.
- В деталях: «Полная сумма / N платежей по X BYN / Списание раз в 30 дней».

DoD L5: ссылка с installment отображается корректно; обычные one_time/subscription без изменений.

---

### Stage L6 — Verify (runtime proof)

1. Создать/отредактировать в админке кнопку «Рассрочка» в тарифе (например «Подоходный налог для ИП») с `max_months=6`.
2. В карточке контакта выбрать эту кнопку, выбрать `selected=3`, создать публичную ссылку.
3. Открыть `/pay/:token`, проверить dropdown 2..6, выбрать 3 (или оставить переданное), оплатить тестовой картой.
4. SQL-proof:
  - `payment_links.meta.installment.selected_installment_months = 3`, `max_installment_months = 6`.
  - `orders_v2.meta`: `is_installment=true`, `installment_count=3`.
  - `installment_payments`: ровно 3 строки, payment_number 1..3, amount одинаковый, payment 1 = succeeded, 2-3 = pending, due_date второго = first+30д, третьего = first+60д.
  - `audit_logs`: `payment_link.created` (installment:true, selected:3, max:6), `installment_started` (count=3).
  - `subscriptions_v2`: одна активная.
5. Граничные кейсы:
  - В `public-checkout` POST с `selected_installment_months=7` при max=6 → 400.
  - С `selected=1` → 400.
  - Idempotency: повторная отправка webhook не создаёт дубликатов.
6. После cron-списания всех 3 платежей: 4-й платёж невозможен (нет 4-й pending-строки), `installment-charge-cron` ничего не делает, `subscriptions_v2.access_end_at` не продлевается рассрочкой.

Фиксируется в `.lovable/proofs/installment_link_runtime.txt`.

---

### Stage L7 — DoD общий (границы)

- Если у кнопки `max_months=6` — выбор 7..12 невозможен ни в карточке контакта, ни на `/pay/:token`, ни через прямой POST в `public-checkout` (валидация на сервере 400).
- Если `max_months=12` — доступны 2..12.
- `selected_installment_months = N` ⇒ создаётся **ровно N** строк в `installment_payments`. Лишние списания невозможны (cron работает по существующим pending-строкам, новых не создаёт).
- После N-го платежа рассрочка завершается; `subscriptions_v2` доживает до конца `access_end_at` тарифа независимо от рассрочки.
- Существующие installment-офферы (после L0b backfill) продолжают работать в `direct-charge` без регрессов.

---

### Что НЕ делаем (anti-scope)

- Не вводим новый `offer_type='installment'` (CHECK не трогаем).
- Не добавляем новых колонок в `tariff_offers` или `payment_links` (всё через `meta`).
- Не пишем новый писатель ссылок и новый payment-flow — только расширение существующих writer/checkout/webhook.
- Не меняем поведение `direct-charge` коммерчески: для прямого `direct-charge` рассрочка = `installment_count` оффера (это тоже будет `meta.installment.max_months` после L0b). Возможность выбора срока **в `direct-charge**` — отдельный backlog `PAY-installment-direct-charge-month-picker`.
- Не расширяем Telegram-уведомления — backlog `PAY-installment-notify-TG`.
- Не вводим «рассрочка для произвольного продукта без кнопки» — backlog `PAY-installment-adhoc-link`.

---

### Технический контракт (single source of truth)


| Решение                         | Источник истины                                                           |
| ------------------------------- | ------------------------------------------------------------------------- |
| Признак installment-кнопки      | `tariff_offers.payment_method='internal_installment'`                     |
| Максимальный срок               | `tariff_offers.meta.installment.max_months` (legacy: `installment_count`) |
| Интервал                        | фиксированно 30 дней                                                      |
| Задержка первого платежа        | фиксированно 0                                                            |
| Выбранный срок (per-link)       | `payment_links.meta.installment.selected_installment_months`              |
| Выбранный срок (per-order)      | `orders_v2.meta.installment_count`                                        |
| Per-payment сумма               | `floor(total / selected)` BYN, без копеек                                 |
| Создание `installment_payments` | только `_shared/installment-schedule.ts`                                  |
| Выдача доступа                  | только `grant-access-for-order`                                           |
| Cron / уведомления              | без изменений                                                             |
