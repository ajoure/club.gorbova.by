# Да, согласен, с учетом правок:

&nbsp;

1. Не ограничиваться только subscriptions_v2.
  Проверка конфликта должна быть **канонической по двум слоям**:
  &nbsp;
  - основной SoT для UI и блокировки — subscriptions_v2;
  - дополнительная верификация провайдерской связки — provider_subscriptions / bepaid_subscription_id, если запись есть.
    Причина: нельзя снова получить рассинхрон “в БД одно, у провайдера другое”.
  &nbsp;
2. Guard должен быть **fail-closed**, а не fail-open.
  Если сервер не смог надёжно проверить наличие существующей подписки, новую подписку **не создавать**. Возвращать техническую ошибку проверки конфликта. Иначе снова получим дубль.
3. Конфликт определять строго по:
  &nbsp;
  - user_id
  - product_id
  - tariff_id
  - статусы: active, trial, past_due, grace_period
    pending включать **только если это уже реально созданная подписка**, а не просто брошенный checkout. Иначе будут ложные блокировки.
  &nbsp;
4. Ответ о конфликте должен быть структурированным, но ещё добавить:
  &nbsp;
  - subscription_v2_id
  - provider_state / provider_subscription_id, если есть
  - display_next_charge_at
  - display_access_end_at
  - timezone_used
    Чтобы UI не вычислял бизнес-логику сам.
  &nbsp;
5. В сценарии **«Заменить подписку»** нельзя делать просто force_replace: true.
  Нужно жёстче:
  &nbsp;
  - пользователь выбирает конкретную конфликтующую subscription_v2_id;
  - сервер отменяет **именно её** у провайдера;
  - убеждается, что отмена успешна;
  - помечает старую запись корректным статусом;
  - только потом создаёт новую;
  - новый checkout разрешается только с серверным признаком вида replacement_of_subscription_v2_id, а не общим bypass-флагом.
    Иначе можно случайно обойти защиту не по той подписке.
  &nbsp;
6. После успешной замены обязательно писать аудит минимум с такими полями:
  &nbsp;
  - old_subscription_v2_id
  - new_order_id / new_checkout_id
  - product_id
  - tariff_id
  - old_provider_subscription_id
  - cancel_result
  - actor_type
  - user_id
  &nbsp;
7. Для UI:
  &nbsp;
  - сначала предупреждение;
  - если пользователь выбирает “Оставить текущую”, checkout не создаётся;
  - если выбирает “Заменить”, надо показать промежуточный state:
    **«Отменяем текущую подписку…»** → **«Создаём новую…»**
    Нельзя делать это как один немой клик без статусов.
  &nbsp;
8. Отдельно зафиксировать STOP-guard:
  &nbsp;
  - если у старой подписки отмена у провайдера прошла, но новая checkout-сессия не создалась, состояние должно быть прозрачно залогировано и показано в UI;
  - не допускать скрытого частично выполненного сценария.
  &nbsp;
9. В DoD добавить 2 обязательных proof-кейса:
  &nbsp;
  - кейс Казачек: повторно создать вторую подписку по тому же продукту/тарифу **нельзя**;
  - кейс с другим тарифом того же продукта: новая подписка **разрешается**.
  &nbsp;
10. Формулировку по файлу лучше поправить:
  не писать абстрактно create-payment-checkout.ts, а использовать **точное текущее имя функции/файла в проекте**, чтобы подрядчик не полез править не тот checkout-flow.

&nbsp;

&nbsp;

Итог: направление у плана правильное. Нужны эти уточнения, чтобы защита была действительно серверной, не обходилась флагом и не создавала новый рассинхрон.

&nbsp;

План: PATCH E — Запрет двойных подписок по одному продукту и тарифу

## Диагностика текущего состояния

### Что уже есть

В `create-payment-checkout.ts` (строки 352-444) есть **Duplicate Guard**, но с дефектами:

1. **Проверяет только `provider_subscriptions**`, а не `subscriptions_v2` напрямую — если provider_subscription потеряна или не создана, guard пропускает дубль
2. **Не проверяет `tariff_id**` — блокирует ВСЕ подписки на тот же продукт, даже с другим тарифом (слишком жёстко)
3. **Fail-open** при ошибке (строка 443) — при любом сбое guard молча пропускает
4. **Не проверяет `subscriptions_v2` по статусам** active/trial/past_due/grace_period
5. **Возвращает плоскую ошибку** `{ success: false, error: '...' }` — нет структурированных данных о конфликте
6. **В UI** (`AdminPaymentLinkDialog.tsx`) ошибка показывается через `toast.error` — нет предложения заменить подписку

### Доступная функция отмены

`bepaid-cancel-subscriptions/index.ts` — готовая функция отмены подписки у bePaid по `subscription_ids` или `subscription_v2_id`. Переиспользуем.

---

## Что делаем

### E.1 — Новый guard в `create-payment-checkout.ts`

**Заменяем** текущий Duplicate Guard (строки 352-444) на проверку по `subscriptions_v2`:

```sql
SELECT id, status, access_end_at, next_charge_at, bepaid_subscription_id, billing_type
FROM subscriptions_v2
WHERE user_id = $user_id
  AND product_id = $product_id
  AND tariff_id = $tariff_id
  AND status IN ('active', 'trial', 'past_due', 'grace_period')
LIMIT 1
```

- Если найдена конфликтующая подписка → не создавать новую
- Если статус `expired`, `superseded`, `cancelled`, `revoked` → не считать конфликтом
- Если другой `tariff_id` → не блокировать

### E.2 — Структурированный ответ о конфликте

Вместо плоской ошибки возвращать:

```typescript
{
  success: false,
  error: 'existing_subscription_conflict',
  conflict: {
    existing_subscription_id: string,
    status: string,
    next_charge_at: string | null,
    access_end_at: string | null,
    bepaid_subscription_id: string | null,
    product_id: string,
    tariff_id: string,
  }
}
```

Обновить `CreateCheckoutError` интерфейс с опциональным полем `conflict`.

### E.3 — UI предупреждение в `AdminPaymentLinkDialog.tsx`

При получении `error === 'existing_subscription_conflict'`:

- Показать блок с информацией о существующей подписке (статус, дата следующего списания)
- Две кнопки: «Оставить текущую» / «Заменить подписку»
- Дата в формате `Europe/Minsk`

### E.4 — Сценарий «Заменить подписку»

При выборе замены:

1. Вызвать `bepaid-cancel-subscriptions` с `subscription_v2_id` старой подписки
2. Дождаться подтверждения отмены (`canceled` в ответе)
3. Обновить `subscriptions_v2` → `status: 'superseded'`
4. Записать аудит `subscription.replaced`
5. Только после успеха — повторно вызвать `createPaymentCheckout` (с флагом `force_replace: true` для обхода guard)

### E.5 — STOP-guard при неудачной отмене

Если `bepaid-cancel-subscriptions` вернул `failed` — не создавать новую подписку, показать ошибку.

---

## Изменяемые файлы


| Файл                                                    | Что меняется                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `supabase/functions/_shared/create-payment-checkout.ts` | Замена Duplicate Guard на проверку по `subscriptions_v2`, структурированный ответ, поддержка `force_replace` |
| `src/components/admin/AdminPaymentLinkDialog.tsx`       | UI конфликта: блок предупреждения, кнопки «оставить»/«заменить»                                              |


## Что НЕ делаем

- Не создаём новых таблиц
- Не создаём новых edge functions
- Не хардкодим продуктовые legacy-коды
- Не отменяем подписку только локально без подтверждения от bePaid
- Не создаём дубликатов подписки при замене

## DoD

1. Вторую активную подписку по тому же `product_id + tariff_id` создать нельзя
2. Пользователь видит предупреждение до оплаты с датой следующего списания
3. Сценарий «заменить» работает только через успешную отмену у bePaid
4. Другой тариф по тому же продукту — не блокируется
5. Завершённая подписка — не блокирует новую
6. Аудит `subscription.replaced` записан
7. Есть browser-proof