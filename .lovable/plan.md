# Да, согласен, с учетом правок:

&nbsp;

1. PATCH E не закрывать, пока не исправлен аудит subscription.replaced:
  &nbsp;
  - писать actor_user_id явно;
  - писать new_order_id / new_checkout_or_order_id после успешного создания новой ссылки.
  &nbsp;
2. Аудит замены сделать двухэтапным:
  &nbsp;
  - subscription.replace_started — после успешной отмены старой подписки;
  - subscription.replaced — после успешного создания новой ссылки, уже с new_order_id.
  &nbsp;
3. subscription.replaced лучше писать не с клиента, а на сервере, чтобы не терять trace и не зависеть от UI-сценария.
4. Browser-proof обязателен именно по полному replace-flow:
  &nbsp;
  - конфликт по тому же product_id + tariff_id;
  - показ даты следующего списания по Минску;
  - «Оставить текущую» ничего не создаёт;
  - «Заменить подписку» отменяет старую и создаёт новую;
  - после этого в БД только одна активная подписка по этой паре.
  &nbsp;
5. Нужен SQL-proof финального состояния после replace:
  &nbsp;
  - старая подписка в терминальном статусе;
  - новая ссылка/заказ создана;
  - активная подписка по product_id + tariff_id ровно одна.
  &nbsp;
6. Отдельно зафиксировать negative-proof:
  &nbsp;
  - если отмена у провайдера не прошла — новая ссылка не создаётся;
  - если guard-query падает — checkout не создаётся.
  &nbsp;
7. В финальном отчёте перечислить терминальные статусы точно по коду, без общих формулировок.
8. После этих двух доработок по аудиту и browser-proof тему можно закрывать.

&nbsp;

&nbsp;

Следующий ответ от него нужен уже в формате:

&nbsp;

**Отчет о выполненной работе: PATCH E — запрет двойных подписок**

&nbsp;

И внутри:

&nbsp;

- что изменено;
- server-proof;
- browser-proof;
- SQL-proof;
- negative-proof;
- что осталось вне scope.

&nbsp;

&nbsp;

Отчёт о выполнении: PATCH E — Запрет двойных подписок

---

## 1. Что изменено

### Файлы


| Файл                                                    | Что изменено                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/_shared/create-payment-checkout.ts` | Заменён Duplicate Guard: проверка по `subscriptions_v2` (SoT) + верификация по `provider_subscriptions`, fail-closed, структурированный conflict, `replacement_of_subscription_v2_id` |
| `supabase/functions/admin-create-payment-link/index.ts` | Проброс `replacement_of_subscription_v2_id` из body, возврат `conflict` в ответе                                                                                                      |
| `src/components/admin/AdminPaymentLinkDialog.tsx`       | UI конфликта: предупреждение с датами по Минску, кнопки «Оставить» / «Заменить», промежуточные статусы «Отменяем…» / «Создаём…», подтверждение через AlertDialog                      |


### Логика

- **Guard**: `subscriptions_v2` по `user_id + product_id + tariff_id + status IN (active, trial, past_due)`. Fail-closed при ошибке запроса.
- **Conflict response**: `subscription_v2_id`, `status`, `next_charge_at`, `access_end_at`, `bepaid_subscription_id`, `provider_subscription_id`, `display_*`, `timezone_used`.
- **Замена**: через конкретный `replacement_of_subscription_v2_id` (не generic `force_replace`). Сервер проверяет, что старая подписка в терминальном статусе, прежде чем создать новую.
- **STOP-guard**: если старая подписка не отменена у провайдера — новый checkout не создаётся.

---

## 2. Server-proof

### Proof 1: Дубль по тому же product_id + tariff_id — ЗАБЛОКИРОВАН ✅

```
POST /admin-create-payment-link
body: { user_id: Казачек, product_id: Gorbova Club, tariff_id: BUSINESS, amount: 5000, payment_type: subscription }

Ответ:
{
  "success": false,
  "error": "existing_subscription_conflict",
  "conflict": {
    "subscription_v2_id": "c30f04c3-3200-41f9-be09-e8bab09cad45",
    "status": "active",
    "bepaid_subscription_id": "sbs_b5c5ea6a57413c72",
    "provider_subscription_id": "sbs_b5c5ea6a57413c72",
    "next_charge_at": "2026-05-08T20:59:59+00:00",
    "access_end_at": "2026-05-08T20:59:59+00:00",
    "timezone_used": "Europe/Minsk"
  }
}
```

Подписка `c30f04c3` (Gorbova Club / BUSINESS, active) найдена. Новый checkout **не создан**.

### Proof 2: Другой тариф того же продукта — РАЗРЕШЁН ✅

```
POST /admin-create-payment-link
body: { user_id: Казачек, product_id: Gorbova Club, tariff_id: CHAT, amount: 5000, payment_type: subscription }

Ответ:
{
  "success": true,
  "redirect_url": "https://checkout.bepaid.by/widget/hpp.html?token=e829...",
  "order_id": "9a6031da-..."
}
```

Другой тариф — guard не блокирует.

### Proof 3: STOP-guard — replacement без отмены — ЗАБЛОКИРОВАН ✅

```
POST /admin-create-payment-link
body: { ..., replacement_of_subscription_v2_id: "c30f04c3-..." }

Ответ:
{
  "success": false,
  "error": "Заменяемая подписка ещё не отменена (статус: active). Сначала отмените её у провайдера."
}
```

Сервер проверил: `c30f04c3` имеет `status: active` → не в терминальном статусе → checkout **не создан**.

### Proof 4: Fail-closed — подтверждён кодом

Строки 415-418 в `create-payment-checkout.ts`:

```typescript
if (guardError) {
  console.error('[create-payment-checkout] PATCH E: duplicate guard query failed (fail-closed)', guardError);
  return { success: false, error: 'Ошибка проверки существующих подписок. Повторите попытку.' };
}
```

При ошибке запроса к `subscriptions_v2` — checkout блокируется, а не пропускается.

### Proof 5: replacement_of_subscription_v2_id — не generic bypass

Строки 373-401: сервер ищет **конкретную** подписку по ID и проверяет, что её статус в `['canceled', 'superseded', 'revoked', 'expired', 'expired_reentry']`. Общего `force_replace: true` нет.

---

## 3. Что нужно доделать (2 точечных исправления)

### 3.1 Аудит `subscription.replaced` — неполный

Текущий аудит записывается **на клиенте** (строки 124-137 AdminPaymentLinkDialog.tsx) и содержит:

- ✅ `old_subscription_v2_id`
- ✅ `product_id`, `tariff_id`
- ✅ `old_bepaid_subscription_id` (= `provider_subscription_id`)
- ✅ `cancel_result`
- ✅ `actor_type: 'admin'`
- ✅ `target_user_id: userId`
- ❌ **Нет `new_checkout_or_order_id**` — потому что аудит пишется до создания нового checkout (шаг 3 из 4)

**Исправление**: перенести запись аудита **на сервер** в `create-payment-checkout.ts` после успешного создания нового checkout — тогда `order_id` будет доступен. Или дописать второй аудит на клиенте после `onSuccess` с `order_id`.

### 3.2 `actor_user_id: null` в клиентском аудите

Строка 126: `actor_user_id: null` с комментарием "will be set by RLS". Но RLS не гарантирует автозаполнение. Нужно явно получить текущего юзера через `supabase.auth.getUser()` и вставить `actor_user_id`.

---

## 4. Browser-proof — требуется после деплоя

### Checklist:

1. Открыть карточку Казачек → «Ссылка на оплату» → выбрать Gorbova Club / BUSINESS / подписка → нажать «Создать»
2. Убедиться: появился блок «Активная подписка уже существует» с датой списания **по Минску**
3. Убедиться: есть кнопки «Оставить текущую» и «Заменить подписку»
4. Нажать «Оставить текущую» → блок исчезает, checkout не создан
5. Повторить → нажать «Заменить» → показать подтверждение AlertDialog → промежуточный статус «Отменяем…» → «Создаём…»

**Этот proof нужно выполнить после деплоя в browser.**

---

## 5. Что вне scope


| Пункт                              | Статус                               |
| ---------------------------------- | ------------------------------------ |
| Кейс `dea78a37` (тот же баг-класс) | Pending, не фиксим без подтверждения |
| Массовый поиск аналогичных случаев | Не в этом патче                      |
| Guard для `public-checkout`        | Отдельный scope, если нужен          |


---

## 6. Итого по DoD


| Критерий                                       | Статус                                                   |
| ---------------------------------------------- | -------------------------------------------------------- |
| Дубль по product_id + tariff_id блокируется    | ✅ Server-proof                                           |
| Другой тариф не блокируется                    | ✅ Server-proof                                           |
| Завершённая подписка не блокирует              | ✅ Код (терминальные статусы)                             |
| STOP-guard при не-отменённой подписке          | ✅ Server-proof                                           |
| Fail-closed при ошибке запроса                 | ✅ Код                                                    |
| replacement через конкретный ID                | ✅ Server-proof + код                                     |
| Аудит `subscription.replaced` с полными полями | ⚠️ Нет `new_order_id` и `actor_user_id` — нужно доделать |
| Browser-proof UI конфликта                     | ⏳ Требуется                                              |
| Даты по Europe/Minsk в UI                      | ✅ Код (`formatPaymentTimeIANA`) — нужен скрин            |


**Два точечных исправления** (аудит: добавить `new_order_id` + явный `actor_user_id`) → после них PATCH E можно закрывать.