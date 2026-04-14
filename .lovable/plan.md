# да, согласен, с учетом правок:

&nbsp;

1. В разделе **Диагностика** зафиксируй жёстче:
  рабочий flow из карточки контакта через admin-create-payment-link → _shared/create-payment-checkout.ts считать **основным каноническим owner-flow для one-time checkout**.
  bepaid-create-token не считать owner, а только legacy entrypoint, который должен быть приведён к каноническому backend path.
2. В разделе **Изменения 1** уточни формулировку:
  цель не просто “заменить inline checkout код”, а **устранить самостоятельную one-time реализацию внутри bepaid-create-token**.
  После патча one-time ветка не должна:
  &nbsp;
  - писать в orders;
  - собирать checkout payload вручную;
  - формировать свой tracking;
  - иметь собственную bePaid business-логику.
    Она должна только резолвить входные данные и передавать их в createPaymentCheckout().
  &nbsp;
3. Добавь отдельный подпункт по **legacy cleanup guard**:
  после перевода one-time path на shared helper нужно убедиться, что в runtime больше **не создаются новые записи в legacy orders** из сайтовых тарифных кнопок.
  Это важный proof, иначе можно формально “починить редирект”, но оставить старый сломанный хвост.
4. В блоке про **MIT ветку** уточни:
  не ограничиваться только заменой auth header, а явно проверить, используется ли MIT path вообще из client flow после текущих изменений.
  Если не используется с сайтовых тарифных кнопок, не расширять scope и не делать лишних архитектурных правок.
  Только зафиксировать, что баг найден, и минимально убрать double Basic, если этот код остаётся живым.
5. В разделе **Saved card** усили правило:
  нужно не просто убрать misleading текст, а привести UI к правде:
  &nbsp;
  - не показывать, что оплата пойдёт сохранённой картой, если фактически идёт обычный bePaid checkout;
  - не запирать пользователя в сохранённой карте;
  - всегда оставлять сценарий обычной оплаты через bePaid.
    То есть интерфейс должен соответствовать фактическому backend flow.
  &nbsp;
6. В разделе **DoD / P0** добавь ещё один обязательный proof:
  &nbsp;
  - тот же продукт, который успешно оплачивается через ссылку из карточки контакта,
  - после патча должен успешно оплачиваться и из сайтовой тарифной кнопки
    **на том же backend owner-path**, а не просто “как-то работать”.
  &nbsp;
7. Добавь в **Verify** отдельную проверку:
  сравнить before/after именно для одного и того же сценария:
  &nbsp;
  - тот же продукт;
  - тот же тариф/offer;
  - та же роль пользователя;
  - ссылка из карточки контакта — success;
  - кнопка на сайте — после фикса тоже success.
    Это нужно как прямое доказательство, что сайты переведены на рабочую схему, а не получили отдельный временный костыль.
  &nbsp;
8. В **STOP-guards** добавь:
  если в ходе реализации выяснится, что [club.gorbova.by](http://club.gorbova.by) для подписок использует другой корректный flow, это **не причина плодить второй owner для one-time**.
  Для подписок допускается существующий рабочий subscription path,
  но **для one-time все сайты должны быть сведены к одному каноническому flow**, совпадающему с рабочей ссылкой оплаты из карточки контакта.
9. В финальном выводе для Lovable зафиксируй одной фразой:
  **не чинить симптом в bepaid-create-token, а подчинить его существующему рабочему one-time payment owner-flow, чтобы сайты и ссылки оплаты использовали один и тот же downstream без расхождения.**

&nbsp;

&nbsp;

P0 — Единый канонический payment flow + UX сохранённой карты

## Статус


| PATCH                          | Статус               |
| ------------------------------ | -------------------- |
| P0 — hotfix оплаты (все сайты) | OPEN                 |
| P0.1 — saved card UI           | REVISION             |
| P2 — клиентские ошибки         | FIXED                |
| F2 — auth persistence          | PARTIAL / NOT CLOSED |


## Диагностика — доказанные факты

### Owner-map: три payment path в системе


| Flow                           | Edge Function                                                      | Auth Header                                                     | Таблица                          | Tracking            | Статус     |
| ------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------- | ------------------- | ---------- |
| Admin link / карточка контакта | `admin-create-payment-link` → `_shared/create-payment-checkout.ts` | `bepaidAuth` = `Basic <base64>` (строка 308) ✅                  | `orders_v2`                      | `link:order:{UUID}` | ✅ РАБОТАЕТ |
| Club subscription              | `bepaid-create-subscription-checkout`                              | корректный                                                      | `orders_v2` + `subscriptions_v2` | structured          | ✅ РАБОТАЕТ |
| **Сайтовые кнопки (one-time)** | `bepaid-create-token` inline                                       | ``Basic ${bepaidAuth}`` = `Basic Basic <base64>` (строка 699) ❌ | legacy `orders`                  | `{order.id}`        | ❌ СЛОМАН   |
| **MIT flow**                   | `bepaid-create-token` inline                                       | ``Basic ${bepaidAuth}`` (строка 805) ❌                          | legacy `orders`                  | `{order.id}`        | ❌ СЛОМАН   |


### Root cause — доказано кодом

1. **Double Basic prefix**: `createBepaidAuthHeader()` (строка 116 `bepaid-credentials.ts`) возвращает `"Basic <base64>"`. В `bepaid-create-token` строка 699: ``Basic ${bepaidAuth}`` → `Basic Basic <base64>` → bePaid 500.
2. **Параллельный drift**: `bepaid-create-token` собирает one-time checkout инлайн, игнорируя канонический `_shared/create-payment-checkout.ts`. Пишет в legacy `orders` (строка 444-470), нет `purchase_snapshot`, нет dedup, другой tracking.
3. **MIT flow**: строка 805 — тот же double-prefix баг, те же legacy `orders`.

### Canonical owner — найден

`_shared/create-payment-checkout.ts` — единственная рабочая функция создания платёжной ссылки. Используется из `admin-create-payment-link`. Все downstream (webhook → order update → entitlements → access) завязаны на tracking format `link:order:{UUID}` и таблицу `orders_v2`.

### Saved card — доказано misleading для ВСЕХ типов

По коду PaymentDialog.tsx строки 502-504: client flow **всегда** идёт через стандартный bePaid checkout с 3DS. Saved card **не передаётся** в bePaid ни для one-time, ни для subscription client flow. bePaid всегда показывает форму ввода карты. UI «Оплата сохранённой картой» вводит в заблуждение для **всех** продуктов.

## Принцип решения

**Жёсткое правило**: не создавать никаких новых edge functions, payment handlers, checkout flows, временных product-specific веток. Исправление — только через переиспользование уже существующей рабочей `createPaymentCheckout()`.

## Изменения

### 1. `supabase/functions/bepaid-create-token/index.ts`

**One-time ветка** (строки 664-753): заменить inline checkout код на вызов `createPaymentCheckout()`:

- Импортировать `createPaymentCheckout` из `../_shared/create-payment-checkout.ts`
- Resolve `tariff_id` UUID через существующий lookup (строки 494-501 уже делают это для tariffCode)
- Передать: `supabase`, `user_id: userId`, `product_id: productId`, `tariff_id`, `amount` в копейках, `payment_type: 'one_time'`, `offer_id`, `origin`, `actor_type: 'system'`
- Вернуть `redirectUrl` из результата shared helper
- Убрать запись в legacy `orders` для этого path — shared helper пишет в `orders_v2`

**MIT ветка** (строки 756-883): минимальный фикс auth header — строка 805: `'Authorization': bepaidAuth` вместо ``Basic ${bepaidAuth}``

### 2. `src/components/payment/PaymentDialog.tsx`

**Убрать misleading saved card UI для ВСЕХ продуктов** (строки 1084-1098). Единый текст: «После нажатия кнопки вы будете перенаправлены на защищённую страницу оплаты bePaid.»

Обоснование: saved card в client flow — cosmetic only для всех типов продуктов. bePaid всегда показывает форму карты.

### 3. `.lovable/plan.md` — обновить статусы

## НЕ делаем

- Не создаём новых edge functions / payment handlers / checkout flows
- Не создаём новую логику для consultation / site builder / «закрой год» отдельно
- Не оставляем клуб на одном flow, а остальные сайты на другом
- Не допускаем разных webhook/downstream после оплаты
- Не трогаем `bepaid-create-subscription-checkout`, `admin-create-payment-link`, `_shared/create-payment-checkout.ts`, webhook
- Не оживляем `ConsultationPaymentDialog.tsx`

## STOP-guards

- Если `createPaymentCheckout` требует `tariff_id` UUID — resolve через существующий tariff lookup в `bepaid-create-token` (строки 494-501)
- Если рабочий flow уже есть в карточке контакта — запрещено изобретать новый path вместо переиспользования
- Если club subscription flow работает — не трогать
- Не закрывать P0, пока consultation и другие сайты не подтверждены на каноническом owner-path

## DoD

### P0

- Сайтовые кнопки используют тот же `createPaymentCheckout()`, что и admin link из карточки контакта
- Auth header корректный (нет двойного `Basic`)
- Заказ создаётся в `orders_v2` (не legacy `orders`)
- Tracking `link:order:{UUID}` — webhook обрабатывает корректно
- Downstream после оплаты: order → subscription → entitlements → access — тот же путь
- Club, consultation, «ЗАКРОЙ ГОД» не расходятся по payment owner-path
- При ошибке модалка не закрывается, пользователь может повторить
- Пользователь не видит misleading «Оплата сохранённой картой»
- Runtime-proof обязателен перед закрытием

### F2

- Остаётся PARTIAL / NOT CLOSED до browser-proof