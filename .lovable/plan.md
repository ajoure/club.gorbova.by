да, согласен, с учетом правок:

1. **Строго разделить “Активные подписки” и “Платежи”**
  &nbsp;
  В `/purchases`:
  ```text
  Активные подписки = только реально активный доступ / подписка
  Платежи = история заказов и оплат, включая pending/processing/failed/paid/refunded
  ```
  Не показывать pending/processing как активную подписку.
2. **Source of truth для активной подписки**
  &nbsp;
  Активной считать только если есть:
  ```text
  subscription.status IN ('active', 'trialing')
  OR entitlement.status='active' AND expires_at > now()
  ```
  Не использовать `orders_v2.status='pending'` как основание для карточки активной подписки.
3. **Pending/processing показывать отдельно**
  &nbsp;
  Если нужно показывать незавершённую оплату, то только в отдельном блоке:
  ```text
  Незавершённые оплаты
  ```
  или внутри вкладки **Платежи**, но не как «Активная подписка».
4. **Receipt URL**
  &nbsp;
  Логика правильная:
  ```text
  payment.receipt_url
  payment.provider_response.transaction.receipt_url
  ```
  Добавить fallback:
  ```text
  если receipt_url отсутствует — кнопку “Чек bePaid” не показывать
  ```
  Не показывать disabled-кнопку без объяснения.
5. **Две разные кнопки не смешивать**
  &nbsp;
  В деталке подписки:
  ```text
  Чек bePaid = официальный чек/receipt от bePaid
  Скачать квитанцию = наш внутренний PDF
  ```
  Обе кнопки могут быть одновременно.
6. **Фильтры вкладки “Платежи”**
  &nbsp;
  Я бы не исключал `pending/processing` полностью из вкладки **Платежи**. Лучше так:
  ```text
  Платежи:
  - paid/succeeded
  - failed
  - refunded
  - pending/processing, но с отдельным статусом “В обработке”
  ```
  А вот из **Активных подписок** pending/processing убрать полностью.
7. **Добавить anti-duplicate guard**
  &nbsp;
  Один order/payment не должен одновременно отображаться:
  - как активная подписка;
  - как платёж;
  - как незавершённая оплата.
  Правило:
8. **Проверить route после оплаты**
  &nbsp;
  После возврата с bePaid `/payment-result` пользователь должен попасть в состояние:
  ```text
  processing → ожидание webhook
  paid → активный доступ
  failed → ошибка платежа
  ```
  И `/purchases` должен корректно обновляться после webhook.
9. **STOP-guards**
  &nbsp;
  Добавить:
10. **DoD дополнить SQL/proof**

Добавить проверки:

```sql
-- pending не попадают в активные подписки
SELECT count(*)
FROM orders_v2
WHERE status IN ('pending','processing')
  AND id IN (<ids shown in active subscriptions>);
```

И UI-proof:

```text
- pending order виден только в Платежах / Незавершённых;
- active entitlement виден в Активных подписках;
- bePaid receipt открывается реальной ссылкой;
- наш PDF скачивается отдельно.
```

Готовый блок для Lovable:

```text
Дополни план правками:

1. В `/purchases` строго разделить:
   - Активные подписки = только active/trialing subscription или active entitlement/access;
   - Платежи = история заказов/оплат;
   - pending/processing не показывать как активную подписку.

2. Pending/processing показывать только во вкладке “Платежи” или в отдельном блоке “Незавершённые оплаты”.

3. Не исключать pending/processing из истории платежей полностью — показывать их со статусом “В обработке”, но не как активный доступ.

4. Для bePaid receipt использовать:
   - `payment.receipt_url`;
   - fallback `payment.provider_response.transaction.receipt_url`.
   Если receipt_url отсутствует — кнопку “Чек bePaid” не показывать.

5. Разделить две кнопки:
   - “Чек bePaid” = официальный receipt от bePaid;
   - “Скачать квитанцию” = наш внутренний PDF.
   Обе могут отображаться одновременно.

6. Добавить anti-duplicate guard: один order/payment не должен одновременно отображаться как активная подписка и как платёж.

7. Проверить `/payment-result` → `/purchases`: после webhook статус должен обновляться корректно.

8. STOP-guards:
   - не менять bePaid webhook;
   - не менять grant-access-for-order;
   - не менять orders/payments статусы;
   - не менять entitlements;
   - не создавать новые receipt-сущности;
   - не подменять bePaid чек нашим PDF.

9. DoD:
   - pending/processing не отображаются в “Активных подписках”;
   - pending/processing видны только в “Платежах” или “Незавершённых оплатах”;
   - active entitlement/subscription отображается в “Активных подписках”;
   - кнопка “Чек bePaid” открывает реальный receipt_url;
   - кнопка “Скачать квитанцию” скачивает наш PDF;
   - mobile 375px и desktop 1440px без overflow;
   - финальный отчёт содержит changed files, diff-summary и proof.

План: Чистка «Моих покупок» + канонические карточки + чек bePaid
```

## Что меняем

### 1) Логика фильтрации (что показываем)

**Активные подписки** (`uniqueActiveSubscriptions` в `Purchases.tsx`):

- Сейчас показывает всё, что не истекло — включая `past_due` / `pending` / `unpaid`. Из-за этого появляется «Активная подписка → Ожидает оплаты».
- Меняем фильтр: подписка считается активной только если `status ∈ {active, trial, trialing}` И не истекла. Всё остальное (`past_due`, `unpaid`, `incomplete`, `pending`) уезжает в историю «Прошлые подписки» с человеческим лейблом.

**История платежей** (`orders` в Tab «Платежи»):

- Сейчас показывает все заказы, в т.ч. `pending` / `processing` / `created`.
- Фильтр: показываем только заказы, где `payment.status ∈ {succeeded, failed}` ИЛИ `order.status ∈ {paid, failed, refunded}`. Заказы в обработке / created / pending — скрываем полностью (они не несут пользы клиенту).
- Лейбл «В обработке» из `OrderListItem.getStatusBadge()` удаляем как сценарий — но defensive-маппинг оставляем на случай, если что-то проскочит.

### 2) Кнопка «Документы по заказу» → чек bePaid

В `Purchases.tsx` справа от каждого заказа сейчас рисуется отдельная иконка `FileText` → `OrderDocuments` (наш PDF-генератор). Заменяем поведение:

- Если у платежа есть `receipt_url` (bePaid) — кнопка открывает его в новой вкладке (`window.open(receiptUrl, '_blank')`).
- Если заказ `failed` — кнопка ведёт на тот же `receipt_url` (у bePaid там страница с ошибкой) — подпись «Чек об ошибке».
- Если `receipt_url` нет — кнопка скрыта.
- Внутреннюю кнопку «Документы» (dropdown с PDF / отправкой на почту / Telegram) в `OrderListItem` оставляем как есть для оплаченных — это рабочий функционал. Удаляем только дубль-иконку `FileText` в `Purchases.tsx`, которая открывала `OrderDocuments` Sheet (он становится не нужен в этом потоке — снимаем с UI, файл не трогаем).

### 3) Канонический дизайн карточек (белый фон, как в остальном кабинете)

Привести `SubscriptionListItem`, `OrderListItem`, `SubscriptionDetailSheet` к единому стилю:

- Базовый фон `bg-card` (уже есть), но добавить мягкие границы `border-border/60`, `rounded-xl` (вместо `rounded-lg`), `hover:border-primary/30`, `hover:shadow-sm` — каноничный hover как в карточках dashboard.
- Внутренние отступы: `p-4 sm:p-5`.
- Бейджи: вынести статус в правый верхний угол отдельной строкой (как на скрине пользователя) — чтобы заголовок никогда не конкурировал с бейджем за место.
- Цена/дата/карта: единая строка с `text-xs text-muted-foreground` и иконками 3.5x3.5.
- Chevron справа делаем мельче и серее.

`SubscriptionDetailSheet` (внутреннее окно подписки):

- Шапка: заголовок крупный, статус-бейдж — отдельной строкой ниже (а не справа). Фон шапки — `bg-muted/30`, скруглённый блок.
- Группы строк (даты, способ оплаты, история платежей) — каждая в своей карточке `bg-muted/20 rounded-lg p-4`.
- Кнопки внизу: основная «Скачать чек bePaid» (если есть `receipt_url`) первичной кнопкой, «Скачать квитанцию» (наш PDF) — вторичной. **Обе доступны одновременно**, не «или/или».

### 4) Чек bePaid в детальном окне подписки

`SubscriptionDetailSheet`:

- Сейчас: `if (receiptUrl) { кнопка bePaid } else { кнопка нашей квитанции }`.
- Делаем: всегда показываем «Скачать квитанцию» (наш PDF). Дополнительно, если есть `receiptUrl` (из связанного `orders_v2.payments_v2[0].receipt_url`) — показываем сверху primary-кнопку «Чек bePaid».
- В блоке «История платежей» внутри sheet — для каждого `succeeded` платежа уже стоит кнопка скачивания чека, оставляем. Для `failed` платежей — добавляем такую же кнопку, если у платежа есть `receipt_url` (bePaid возвращает ссылку и для ошибочных). Платежи `pending`/`processing` отфильтровываем — не показываем.

### 5) Источник `receipt_url`

В `Purchases.tsx` запрос уже выбирает `provider_response`, но в БД давно есть отдельная колонка `payments_v2.receipt_url` (приоритетная). Добавляем её в SELECT:

- `payments_v2(id, status, provider_payment_id, card_brand, card_last4, receipt_url, provider_response)` — и для orders, и для subscriptions.
- Резолвер: `payment.receipt_url ?? payment.provider_response?.transaction?.receipt_url`.

## Файлы

- `src/pages/Purchases.tsx` — фильтры активных/историй, добавить `receipt_url` в SELECT, заменить иконку FileText на кнопку bePaid-чека (с условным рендером), убрать вызов `OrderDocuments` Sheet из строки заказа (оставить компонент, но без триггера).
- `src/components/purchases/SubscriptionListItem.tsx` — канонический дизайн (rounded-xl, hover, отступы, чистая иерархия заголовок/бейджи/мета).
- `src/components/purchases/OrderListItem.tsx` — канонический дизайн, удалить ветку «В обработке» из бейджа, использовать `receipt_url` как primary источник.
- `src/components/purchases/SubscriptionDetailSheet.tsx` — переверстка шапки и блоков, две кнопки скачивания (bePaid + наш PDF), фильтрация payments по статусу, кнопка чека для failed.

## Технические детали

```text
Active filter:
  status IN ('active','trial','trialing') AND access_end_at > now()

History — payments tab filter:
  payment.status IN ('succeeded','failed') OR
  order.status IN ('paid','failed','refunded')

Receipt URL resolution:
  payment.receipt_url ?? payment.provider_response?.transaction?.receipt_url
```

## DoD

- На `/purchases` нет ни одной «Активной подписки» со статусом «Ожидает оплаты» / «Не оплачена» / «В обработке».
- В Tab «Платежи» нет заказов со статусом «В обработке» / «Создан».
- У оплаченных и провалившихся заказов работает кнопка «Чек bePaid» — открывает реальный URL.
- В детальном окне подписки две кнопки: «Чек bePaid» (если есть) + «Скачать квитанцию» (наш PDF) одновременно.
- Карточки выглядят канонично: белый фон, скругления `rounded-xl`, мягкий hover, корректная иерархия.
- Mobile 375px и desktop 1440px проверены — без переполнений.