да, согласен, с учетом правок:

1. **Не дублировать duplicate-guard в двух backend-точках вручную.**  
Для `bepaid-create-subscription-checkout` и `_shared/create-payment-checkout.ts` должен быть **один общий shared helper**:
  - exact duplicate query;
  - единый список конфликтующих статусов;
  - единый формат ответа `existing_subscription_conflict`.
  Иначе через 1–2 спринта снова появится расхождение между admin-flow и public-flow.
2. **Conflict должен существовать только для подписочного сценария.**  
Явно добавь в план:
  - если выбран `payment_type !== 'subscription'`, никакой subscription-conflict UI не рендерится;
  - stale `conflictData` должен сбрасываться также при переключении с подписки на разовую оплату.
3. **Уточнить allowed statuses для replacement после отмены.**  
Формулировка `terminal statuses` слишком расплывчатая.  
Нужно явно перечислить, какие статусы сервер принимает для `replacement_of_subscription_v2_id` после успешной отмены. Минимально:
  - `superseded`
  - и, если реально используются в проекте, другие финальные статусы по текущему контракту.
  Нельзя оставлять это как “любой terminal”, иначе потом кто-то подмешает неподходящий статус.
4. **Server-side validation replacement нужно делать в обе стороны.**  
Проверять не только:
  - `oldSub.user_id === user_id`
  - `oldSub.product_id === product_id`
  - `oldSub.tariff_id === tariff_id`
  Но и то, что:
  - `replacement_of_subscription_v2_id` передан **только** когда реально есть same-pair conflict;
  - нельзя передать replacement для случая, где активной same-pair подписки нет.
5. **В** `AdminPaymentLinkDialog` **stale-conflict надо сбрасывать не только по product/tariff/offer/type, но и перед каждым новым submit-cycle.**  
То есть:
  - перед `createLinkMutation.mutate()`;
  - перед `replaceSubscriptionMutation.mutate()`;
  - при закрытии/повторном открытии;
  - при смене режима direct/public, если там есть разные ветки создания ссылки.
6. **UI-блок конфликта должен быть привязан к текущей exact-pair, а не просто к наличию объекта.**  
Добавь явный helper:
  - `isCurrentConflict(conflictData, selectedProductId, selectedTariffId)`
  И используй его и для рендера, и для disable состояния кнопки, и для показа confirm-dialog. Не дублировать условие в нескольких местах.
7. **Public** `PaymentDialog` **должен переиспользовать уже существующую admin replacement-логику, а не копировать её вручную.**  
Если сейчас `AdminPaymentLinkDialog` уже содержит рабочий сценарий:
  - cancel old sub;
  - mark superseded;
  - create new checkout with `replacement_of_subscription_v2_id`;
  то в public dialog нужно вынести это в shared action/helper, а не писать вторую похожую реализацию.
8. **Верификация different-product case должна быть на живом конкретном пользователе из жалобы.**  
В `Verify` добавь обязательный proof именно на проблемном кейсе:
  - у пользователя есть активная подписка на продукт A;
  - он покупает продукт B;
  - backend не возвращает `existing_subscription_conflict`;
  - UI не показывает replacement-блок;
  - checkout создаётся штатно.
  Без этого патч нельзя считать закрытым.
9. **Regression-check по public path обязателен отдельно от admin path.**  
Не объединяй их в один пункт.  
Нужно раздельно доказать:
  - admin contact sheet;
  - public `PaymentDialog`;
  - backend direct response для `bepaid-create-subscription-checkout`.
10. **В dry-run добавь ещё один обязательный поиск.**  
Нужно найти все места в коде, где обрабатывается строка:
  - `existing_subscription_conflict`
  И убедиться, что нигде не осталось старое поведение с переходом в `/purchases` или общий “активная подписка уже есть” без проверки exact pair.
11. **Audit-proof нужно зафиксировать явнее.**  
В `Verify` добавь отдельный пункт:
  - при replacement есть proof по трём событиям:
    1. отмена старой подписки у провайдера;
    2. перевод старой подписки в `superseded`;
    3. создание новой оплаты с `replacement_of_subscription_v2_id`.
  Просто “пишет audit” слишком общее.
12. **STOP-guard на unknown user/product/tariff оставить, но не переводить это в user-facing generic message.**  
Во frontend должен идти понятный текст, а не сырой backend error.  
Это особенно важно для public `PaymentDialog`.

Итог: план хороший, но его нужно чуть усилить в части **shared helper**, **точного списка replacement-statuses**, **same-pair only для subscription-flow**, и **proof на реальном кейсе different-product**.

&nbsp;

План: PATCH PAYMENT-CONFLICT — исправить ложный блок оплаты по чужой подписке и вернуть правильный flow замены подписки

## 1. Проблема

Текущая ошибка не должна решаться отправкой пользователя в «Мои покупки».

Правильная логика, которая уже была согласована и частично реализована раньше:

1. Если у пользователя есть активная подписка **на тот же `product_id + tariff_id**`, система показывает конфликт и предлагает:
  - оставить текущую подписку;
  - заменить подписку: сначала отменить старую у провайдера, затем создать новую оплату с `replacement_of_subscription_v2_id`.
2. Если у пользователя есть активная подписка **на другой продукт или другой тариф**, новая покупка не должна блокироваться.

Сейчас поведение выглядит как критическая регрессия: наличие любой активной подписки может блокировать оплату другого продукта либо UI может показывать старый конфликт после смены продукта/тарифа.

## 2. Диагностика

Найденные уже существующие спринты/контракты:

- `mem://commercial-logic/subscriptions/duplicate-subscription-prevention-guard`
  - duplicate guard должен работать только по паре `product_id + tariff_id`;
  - конфликтующие статусы: `active`, `trial`, `past_due`, `grace_period`;
  - UI должен предлагать оставить или заменить подписку;
  - общий `force_replace` запрещен;
  - разрешен только конкретный `replacement_of_subscription_v2_id`.
- `mem://commercial-logic/subscriptions/safe-replacement-flow`
  - сначала отмена старой подписки у провайдера через `bepaid-cancel-subscriptions`;
  - затем перевод старой подписки в `superseded`;
  - затем создание новой оплаты с `replacement_of_subscription_v2_id`;
  - если отмена у провайдера не подтверждена — создание новой подписки запрещено.

Найденная реализация, которую надо не придумывать заново, а восстановить/дотянуть:

- `src/components/admin/AdminPaymentLinkDialog.tsx`
  - уже содержит `conflictData`;
  - уже содержит `replaceSubscriptionMutation`;
  - уже вызывает `bepaid-cancel-subscriptions`;
  - уже передает `replacement_of_subscription_v2_id`;
  - уже показывает кнопки:
    - «Оставить текущую подписку»;
    - «Заменить подписку (отменить старую)».
- `supabase/functions/_shared/create-payment-checkout.ts`
  - уже содержит `replacement_of_subscription_v2_id`;
  - уже содержит guard по `user_id + product_id + tariff_id`;
  - это канонический backend-path для `admin-create-payment-link`.

Подозреваемые точки регрессии:

1. `src/components/admin/AdminPaymentLinkDialog.tsx`
  - `conflictData` сбрасывается при закрытии диалога, но не сбрасывается надежно при смене продукта/тарифа/оффера/типа оплаты;
  - из-за этого UI может продолжать показывать конфликт от предыдущего продукта и визуально выглядеть так, будто «любой активный продукт блокирует оплату».
2. `src/components/payment/PaymentDialog.tsx`
  - публичный диалог оплаты не повторяет правильный replacement-flow;
  - предыдущий предложенный план с переходом в `/purchases` был неверным и будет отменен.
3. `supabase/functions/bepaid-create-subscription-checkout/index.ts`
  - отдельный provider-managed subscription entrypoint должен быть приведен к тому же контракту:
    - конфликт только по тому же `product_id + tariff_id`;
    - structured response `existing_subscription_conflict`;
    - replacement только через конкретный `replacement_of_subscription_v2_id`.

## 3. Предлагаемое решение

### A. Не менять бизнес-правило

Сохраняю строгое правило:

```text
Конфликт = same user_id + same product_id + same tariff_id + active/trial/past_due/grace_period
```

Подписки на другие продукты не являются конфликтом.

### B. Исправить stale-conflict в админском payment link UI

Файл:

- `src/components/admin/AdminPaymentLinkDialog.tsx`

Изменения:

1. При смене:
  - `selectedProductId`;
  - `selectedTariffId`;
  - `selectedOfferId`;
  - `paymentType`;
   сбрасывать:
  - `conflictData`;
  - `replaceStep`;
  - `showCancelConfirm`.
2. Перед каждым новым созданием ссылки явно очищать старый конфликт.
3. Рендерить блок конфликта только если он соответствует текущей выбранной паре:

```ts
conflictData.product_id === selectedProductId &&
conflictData.tariff_id === selectedTariffId
```

Если конфликт не соответствует текущему выбору — он считается stale UI state и не блокирует создание ссылки.

### C. Вернуть правильный public PaymentDialog flow

Файл:

- `src/components/payment/PaymentDialog.tsx`

Изменения:

1. Не делать переход в «Мои покупки» при `existing_subscription_conflict`.
2. Добавить UI по аналогии с уже реализованным `AdminPaymentLinkDialog`:
  - текст: «У вас уже есть активная подписка на этот тариф»;
  - даты следующего списания/доступа;
  - кнопка «Оставить текущую подписку»;
  - кнопка «Заменить подписку».
3. Для замены:
  - вызвать `bepaid-cancel-subscriptions` с `subscription_v2_id`;
  - если отмена успешна — создать новую оплату с `replacement_of_subscription_v2_id`;
  - если отмена неуспешна — остановиться и показать понятную ошибку.
4. Сохранять введенные данные формы, не сбрасывать email/телефон/имя.

### D. Унифицировать backend entrypoint для provider-managed checkout

Файл:

- `supabase/functions/bepaid-create-subscription-checkout/index.ts`

Изменения:

1. Добавить в request:

```ts
replacement_of_subscription_v2_id?: string
```

2. До создания `orders_v2`, `subscriptions_v2` и запроса к bePaid выполнить duplicate guard:

```text
user_id = resolved user
product_id = текущий продукт
tariff_id = текущий тариф
status in active/trial/past_due/grace_period
```

3. Если найден конфликт по той же паре — вернуть:

```json
{
  "success": false,
  "error": "existing_subscription_conflict",
  "conflict": {
    "subscription_v2_id": "...",
    "status": "...",
    "next_charge_at": "...",
    "access_end_at": "...",
    "product_id": "...",
    "tariff_id": "..."
  }
}
```

4. Если активная подписка есть на другой продукт/тариф — не блокировать.
5. Если передан `replacement_of_subscription_v2_id`, проверить серверно:

```text
oldSub.user_id === user_id
oldSub.product_id === product_id
oldSub.tariff_id === tariff_id
oldSub.status in terminal statuses
```

Если не совпадает — STOP, не создавать оплату.

### E. Усилить shared helper replacement guard

Файл:

- `supabase/functions/_shared/create-payment-checkout.ts`

Минимальное усиление:

Сейчас replacement проверяет статус старой подписки. Нужно дополнительно проверить, что заменяемая подписка принадлежит тому же:

- `user_id`;
- `product_id`;
- `tariff_id`.

Это закрывает риск, когда в `replacement_of_subscription_v2_id` передают чужую или другую подписку и тем самым обходят duplicate guard.

## 4. Изменяемые компоненты

Файлы:

1. `src/components/admin/AdminPaymentLinkDialog.tsx`
  - reset stale conflict;
  - display guard по текущему `product_id + tariff_id`.
2. `src/components/payment/PaymentDialog.tsx`
  - правильный conflict UI;
  - replacement-flow вместо перехода в `/purchases`.
3. `supabase/functions/bepaid-create-subscription-checkout/index.ts`
  - exact duplicate guard;
  - structured conflict response;
  - support `replacement_of_subscription_v2_id`.
4. `supabase/functions/_shared/create-payment-checkout.ts`
  - усиление проверки replacement по `user_id + product_id + tariff_id`.

## 5. Что не будет изменено

Не трогаю:

- `src/components/ui/table.tsx`;
- table-shell;
- `/admin/live-events`;
- scroll-контейнеры;
- colgroup / widths;
- роли;
- Eisenhower matrix;
- Balance Wheel;
- раздел «Стратегия»;
- Glass UI темы;
- таблицы базы данных;
- RLS;
- `orders_v2` schema;
- `subscriptions_v2` schema;
- `provider_subscriptions` schema;
- webhook fulfillment;
- Telegram-доступы;
- `grant-access-for-order`.

## 6. Dry-run

Перед Execute выполнить только read-only проверки:

### SQL proof 1 — текущие подписки пользователя

Проверить для проблемного пользователя список активных подписок:

```sql
select
  s.id,
  s.status,
  s.product_id,
  pv.name as product_name,
  s.tariff_id,
  t.name as tariff_name,
  s.next_charge_at,
  s.access_end_at
from subscriptions_v2 s
left join profiles p on p.user_id = s.user_id
left join products_v2 pv on pv.id = s.product_id
left join tariffs t on t.id = s.tariff_id
where lower(p.email) = lower('iryna.troinich@gmail.com')
order by s.created_at desc;
```

### SQL proof 2 — точная конфликтная пара

Для продукта/тарифа, который реально пытаются оплатить, проверить:

```sql
select count(*)
from subscriptions_v2
where user_id = :user_id
  and product_id = :target_product_id
  and tariff_id = :target_tariff_id
  and status in ('active', 'trial', 'past_due', 'grace_period');
```

Ожидания:

- если `count = 0` — оплата не должна блокироваться;
- если `count = 1` — показывается replacement-flow;
- если найдена подписка на другой `product_id` — она не влияет.

### Static dry-run

Проверить, что все duplicate queries используют exact tuple:

```text
user_id + product_id + tariff_id
```

и нет условий вида:

```text
user_id + active status only
```

для блокировки покупки.

## 7. Execute

После approval:

1. Внести минимальные изменения в 4 файла.
2. Не создавать миграций.
3. Не менять таблицы.
4. Не менять UI таблиц.
5. Деплой затронутых backend functions:
  - `bepaid-create-subscription-checkout`;
  - функции, использующие `_shared/create-payment-checkout.ts`, если потребуется redeploy.

## 8. STOP-guards

Остановить выполнение и не создавать оплату, если:

1. Не удалось определить `user_id`.
2. Не удалось определить `product_id`.
3. Не удалось определить `tariff_id`.
4. Duplicate guard query вернул ошибку.
5. `replacement_of_subscription_v2_id`:
  - не найден;
  - принадлежит другому пользователю;
  - относится к другому продукту;
  - относится к другому тарифу;
  - не находится в terminal status после отмены.
6. Отмена у провайдера не подтверждена.
7. В dry-run обнаружится backend path, который блокирует только по `user_id` без `product_id + tariff_id`.

## 9. Verify

После Execute проверить:

### Backend proof

1. Пользователь с активной подпиской на другой продукт может создать оплату нового продукта.
2. Пользователь с активной подпиской на тот же `product_id + tariff_id` получает `existing_subscription_conflict`.
3. Replacement:
  - отменяет старую подписку;
  - переводит ее в `superseded`;
  - создает новую оплату с `replacement_of_subscription_v2_id`;
  - пишет audit.

### UI proof

1. В админском contact sheet:
  - выбрать продукт A с конфликтом;
  - получить conflict block;
  - переключиться на продукт B без конфликта;
  - conflict block исчезает;
  - кнопка создания ссылки снова доступна.
2. В public `PaymentDialog`:
  - при same product/tariff conflict видны кнопки «Оставить» и «Заменить»;
  - нет перехода в «Мои покупки»;
  - сырое `existing_subscription_conflict` пользователю не показывается.

### Regression proof

Проверить, что:

- разовая оплата работает как раньше;
- подписка на другой продукт не блокируется;
- same subscription replacement работает;
- stale conflict не переносится между продуктами;
- таблица `/admin/live-events` не изменилась.

## 10. DoD

PATCH считается принятым, если:

1. Ложный блок по подписке другого продукта устранен.
2. Duplicate guard работает только по `user_id + product_id + tariff_id`.
3. Старый replacement-flow восстановлен, а не заменен переходом в «Мои покупки».
4. Stale `conflictData` не может блокировать другой продукт в UI.
5. `replacement_of_subscription_v2_id` нельзя использовать для чужой/другой подписки.
6. Нет изменений в таблицах, RLS и table-shell.
7. Есть proof:
  - SQL по конкретному пользователю;
  - SQL по точной конфликтной паре;
  - backend response для different product;
  - backend response для same product;
  - UI proof в админке;
  - UI proof в public checkout.