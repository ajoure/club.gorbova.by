да, согласен

Можно выполнять **PAY-G**.

**Контрольный scope**

Только src/components/payment/PaymentDialog.tsx

**Что добавить**

Пояснительный info-блок только при условии:

isSubscription && !isTrial && step === 'ready'

Текст строго:

При оформлении подписки bePaid может показать экран с формулировкой «привязка карты для автоплатежей». Это штатный экран подписки: карта используется для регулярного продления, а списание выполняется по условиям выбранного тарифа.

**Что не трогать**

- edge functions

- bePaid payload

- webhook / grant / consume

- handlePayment

- handleReplaceSubscription

- handleTestPayment

- trial flow

- step-machine

- PublicPayPage.tsx

- БД / RPC / миграции

**DoD**

1. tsc clean.

2. git diff затрагивает только PaymentDialog.tsx.

3. git diff supabase/functions/ пустой.

4. Блок виден только для subscription && !isTrial && step === 'ready'.

5. Для trial и one_time блок не виден.

6. Запрещённых формулировок нет.

После PAY-G отдельным сообщением запускать **PAY-H**.

&nbsp;

План: разделить на два патча — PAY-G (пояснительный блок) сейчас, PAY-H (glass redesign) отдельно после.

---

## Статус ранее открытых пунктов


| Тег                           | Что было                                      | Статус                                                     |
| ----------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| PAY-D                         | Unified selector в `/pay/:token`              | DONE                                                       |
| PAY-HOTFIX                    | React #310 в PublicPayPage (hooks order)      | DONE (опубликовано, проверено в production)                |
| Битые ссылки из CRM-контактов | Тот же регресс PublicPayPage hooks order      | АВТОМАТИЧЕСКИ ЗАКРЫТО hotfix'ом — нужен только smoke-check |
| PAY-G                         | Пояснительный блок про bePaid subscription UI | СЛЕДУЮЩИЙ (этот патч)                                      |
| PAY-H                         | Glass redesign PaymentDialog                  | ОТЛОЖЕН — отдельным execute после PAY-G                    |
| PAY-E                         | Saved-card для subscription                   | ОТЛОЖЕН (вне плана)                                        |


---

## PAY-G — Пояснительный блок про bePaid subscription UI

### Diagnose (read-only, выполнено)

Прочитаны:

- `src/components/payment/PaymentDialog.tsx` (1461 строка)
- `supabase/functions/bepaid-create-subscription-checkout/index.ts`
- `supabase/functions/bepaid-create-token/index.ts`

Факты:

1. Для `isSubscription && !isTrial` клиент вызывает `bepaid-create-subscription-checkout`, который делает POST `https://api.bepaid.by/subscriptions` с payload `{ plan: { title, description, plan: { amount, interval } }, customer, settings: { language: 'ru' } }`.
2. На итоговой странице bePaid пользователь видит заголовок «Привязка карты для автоплатежей …» — это штатный UI bePaid Subscriptions API.
3. **В текущем bePaid Subscriptions API в нашем коде не найдено управляемого поля, которое меняет этот заголовок.** Поэтому в рамках PAY-G не меняем provider payload, а добавляем пояснение до редиректа.

### Scope (PAY-G)

Менять только: `src/components/payment/PaymentDialog.tsx`.

### Что добавить

Пояснительный info-блок на шаге `ready`, **только если** выполнены условия:

- `isSubscription === true`
- `isTrial === false`
- `step === 'ready'`

Размещение: после блока `subscriptionMessage` (~строка 1268), до кнопок «Отмена / Оплатить».

### Точный текст блока

> При оформлении подписки bePaid может показать экран с формулировкой «привязка карты для автоплатежей». Это штатный экран подписки: карта используется для регулярного продления, а списание выполняется по условиям выбранного тарифа.

### Запрещённые формулировки

НЕ писать:

- «проверочное первое списание»
- «сумма реальная, не блокировка»
- «изменить невозможно»

### Что в PAY-G НЕ трогаем

- edge functions (`bepaid-*`, `public-checkout`, `public-charge-saved-card`, `bepaid-webhook`, `grant-access-for-order`, `verify-recurring`, `admin-create-public-link`)
- bePaid payload
- webhook / grant / consume
- `handlePayment`, `handleReplaceSubscription`, `handleTestPayment`
- trial flow (`isTrial` ветки и блок Alert про триал)
- step-машину
- `PublicPayPage.tsx`
- БД, RPC, миграции

### Dry-run (PAY-G)

1. Открыть `/` в preview, выбрать подписочный тариф (Gorbova Club — BUSINESS).
2. На шаге `ready` убедиться что новый info-блок виден, текст совпадает.
3. Открыть продукт с `isTrial=true` — блок НЕ должен показываться.
4. Открыть one-time продукт (консультация) — блок НЕ должен показываться.
5. На viewport 390×844 убедиться что блок не ломает скролл.

### STOP-guards (PAY-G)

- STOP, если PAY-G меняет edge function.
- STOP, если PAY-G меняет payload bePaid.
- STOP, если PAY-G меняет `handlePayment`.
- STOP, если PAY-G меняет trial flow.
- STOP, если PAY-G трогает `PublicPayPage.tsx`.

### DoD (PAY-G)

1. `tsc` чистый.
2. `git diff` затрагивает только `src/components/payment/PaymentDialog.tsx`.
3. `git diff supabase/functions/` — пусто.
4. На preview блок появляется только при `isSubscription && !isTrial` на шаге `ready`.
5. Текст ровно соответствует утверждённой формулировке.

---

## Smoke-check ссылок из CRM-контактов (не отдельный патч)

Битые ссылки из CRM-контактов были тем же регрессом `PublicPayPage` hooks order. После publish hotfix отдельный фикс не нужен.

Шаги smoke-check (выполнить после PAY-G):

1. Открыть `/admin/contacts`, выбрать любой контакт → `ContactDetailSheet`.
2. Создать новую платёжную ссылку через диалог (или взять существующую).
3. Убедиться что URL имеет вид `https://club.gorbova.by/pay/<token>`.
4. Открыть URL в новой вкладке.
5. Страница оплаты должна отрендериться (не пустой экран).

Если smoke-check падает — это уже не PAY-G, а отдельный регресс `PublicPayPage`, поднимать новым тикетом.

---

## PAY-H — Glass redesign PaymentDialog (ОТЛОЖЕН)

**Не начинать до закрытия PAY-G.** После закрытия PAY-G — отдельным сообщением запускаю PAY-H.

### Scope (PAY-H, на будущее)

- Только `src/components/payment/PaymentDialog.tsx`.
- При необходимости — токены в `src/index.css` / `tailwind.config.ts`.
- Использовать существующий `src/components/ui/GlassCard.tsx` как референс стиля (background `linear-gradient(135deg, hsl(var(--card)/0.6), hsl(var(--card)/0.3))` + `backdrop-filter: blur(24px)`).

Цели:

- glass style для `DialogContent` и внутренних info-карточек;
- mobile QA на 390×844;
- без изменений бизнес-логики;
- без edge functions;
- БЕЗ объяснения про bePaid (оно уже закрыто PAY-G).

### STOP-guards (PAY-H)

- PAY-H не начинать до закрытия PAY-G.
- PAY-H не трогает edge functions, payloads, step-машину, `handlePayment`, `PublicPayPage`.
- Если редизайн ломает адаптив на 390×844 — откат.

---

## Подтверждение по диагностическому вопросу

Подтверждено пользователем:

- В рамках PAY-G достаточно нашего пояснительного блока перед редиректом на bePaid.
- Полный отказ от Subscriptions API / переписывание subscription flow — не делаем.