да, согласен, с учетом правок:

1. **Заголовок отчёта исправить заранее**

В DoD указано:

```text
Отчет о выполнении
```

Нужно строго:

```text
Отчет о выполненной работе: PATCH-NO-CARD-TRIAL-NO-SUBSCRIPTION-ROW
```

2. **Discovery обязателен до guard**

Перед правкой `grant-access-for-order` сначала подтвердить фактический маркер no-card trial в `orders_v2.meta`.

Не писать guard на предполагаемое поле, пока не доказано, что реально есть:

```text
meta.source = 'trial_no_card'
```

или другой фактический маркер.

В отчёте показать пример строки `orders_v2.meta` по no-card trial-заказу.

3. **Guard должен стоять до CREATE/EXTEND subscription**

Правильная точка — до веток:

```text
existingProductSub extend
CREATE new subscription
```

Иначе no-card trial может либо создать новую `subscriptions_v2`, либо продлить уже существующую.

4. **Guard должен блокировать и create, и extend**

В плане написано:

```text
не трогает existing-subscription extend для другого продукта
```

Нужно точнее:

- для **no-card trial этого продукта** не должно быть ни create, ни extend;
- для обычных `pay_now` / recurring / provider-side subscription поведение не меняется;
- для другого продукта guard не срабатывает, потому что order другой.

То есть условие должно быть на сам order:

```ts
order.is_trial === true
Number(order.paid_amount || 0) === 0
order.meta?.source === 'trial_no_card'
```

и при совпадении — полностью пропустить subscription handling.

5. **Audit insert не должен ломать grant**

`grant.skip_subscription_no_card_trial` нужен, но audit failure не должен валить выдачу доступа.

Сделать warning-only:

```text
если audit_logs insert упал → console.warn / non-blocking
```

Не повторять ошибку с молчаливым `WHEN OTHERS THEN NULL`; но и не ломать P0-flow.

6. `results.subscription` **— проверить контракт ответа**

Перед записью:

```ts
results.subscription = { action: 'skipped', reason: 'no_card_trial' };
```

проверить, что `results.subscription` уже существует/используется в таком формате и не ломает frontend/log consumers.

Если формата нет — добавить безопасно:

```ts
results.subscription = {
  action: 'skipped',
  reason: 'no_card_trial',
  order_id: orderId,
  product_id: productId
}
```

7. **Entitlement expiry нужно доказать SQL-ом**

В discovery обязательно показать:

```text
entitlements.expires_at = orders_v2.trial_end_at / meta trial end / paid_at + trial_days
```

Если `entitlements.expires_at` сейчас вычисляется через subscription row, guard делать нельзя до дополнительного fix.

8. **Regression pay_now формулировать осторожно**

В DoD написано:

```text
Regression pay_now → создаётся subscription
```

Это может быть неверно для обычного one-time `pay_now`.

Правильнее:

```text
pay_now ведёт себя как раньше: если до патча создавал subscription — создаёт; если не создавал — не создаёт. Главное: no-card guard не сработал.
```

То же для recurring:

```text
recurring/provider-side subscription продолжает создавать/обновлять нужные subscription records как раньше.
```

9. **Runtime proof по subscriptions_v2**

Проверять не только `order_id`, потому что связь может быть через `user_id/product_id/tariff_id`.

Для no-card trial proof:

```sql
select count(*)
from subscriptions_v2
where user_id = <trial_user_id>
  and product_id = <product_id>
  and created_at >= <test_started_at>;
```

Ожидание:

```text
0
```

Если в таблице нет `product_id`, использовать реальные поля связи: `tariff_id`, `offer_id`, `metadata`, `created_at`.

10. **Repeat guard после cleanup**

После синтетики и cleanup обязательно проверить:

- второй вызов до cleanup возвращал `alreadyUsedTrial=true`;
- после cleanup тестовые данные удалены;
- cleanup не удалил реальные записи.

11. **Не удалять старые trial-sub rows в этом патче**

Согласен: cleanup/backfill старых строк только отдельной задачей.

В отчёте явно указать:

```text
BACKFILL-CLEANUP-NO-CARD-TRIAL-SUBS: out of scope
```

12. **Финальные строки статуса**

В конце отчёта нужно:

```text
no-card trial subscription skip: PASS
entitlement expiry without subscription: PASS
repeat guard: PASS
pay_now regression: PASS
recurring regression: PASS
synthetic cleanup: PASS
PATCH-NO-CARD-TRIAL-NO-SUBSCRIPTION-ROW: PASS
```

После этих правок план можно выполнять.

&nbsp;

План: PATCH-NO-CARD-TRIAL-NO-SUBSCRIPTION-ROW

## Diagnose (что уже известно из proof предыдущего раунда)

- `bepaid-create-token` в no-card ветке создаёт `orders_v2` с `is_trial=true`, `paid_amount=0`, `status='paid'`, `meta = { ...ncMeta, paid_at }`.
- Затем вызывается canonical `grant-access-for-order` (write-path).
- `grant-access-for-order` идёт в стандартную CREATE/EXTEND ветку для `subscriptions_v2`:
  - resolver видит на оффере `891c7fe0…` `meta.recurring.is_recurring = true` (триал-оффер технически родителем recurring-семьи),
  - попадает в `CREATE new subscription` (index.ts ~1740) и пишет sub с `status='active'`, `auto_renew = shouldAutoRenew`, `recurring_snapshot = …`.
- Второй вызов того же email до фикса репит-гварда удлинял ту же sub через `extended_by_orders` (наблюдалось в proof).
- Это нарушает семантику: no-card demo ≠ commercial subscription. Старый guard `subscriptions_v2.is_trial=true` не срабатывал именно поэтому.

Прецедент уже существующего «не создавать sub» — ветка `order_based_only` (index.ts ~1499) с audit-логом. Тот же шаблон применим здесь.

## Scope (минимальный и точечный)

Только discovery + 1 guard в одном write-path. **Никаких** изменений в:

- recurring/pay_now ветках,
- bePaid webhook,
- access-resolver,
- entitlement-резолвере (entitlement продолжает нести `expires_at = trial_end_at`).

## Шаги

### 1. Discovery (read-only, без правок)

1.1. Подтвердить структуру `meta` у no-card trial-заказа: какой именно маркер источника пишет `bepaid-create-token` (на основе кода ветка пишет `ncMeta + { paid_at }`; нужно увидеть, есть ли там `source: 'trial_no_card'` или эквивалент).

1.2. Подтвердить, что `entitlement.expires_at` для no-card trial кладётся напрямую из `trial_end_at` (а не вычисляется из subscription.access_end_at) — значит, subscription row для expiry не нужен.

1.3. Проверить, что нет внешних читателей, ожидающих sub-row для no-card trial:

- `purchases` UI (карточки «Мои покупки»),
- cron `nightly-access-reconcile`,
- `useUserAccess` / `access-resolver.ts` хелперы,
- telegram-grant / live-access резолверы.

Ожидается: все читают entitlements/orders, а sub не критична для триала.

### 2. Точечный fix (две минимальные правки)

2.1. `**bepaid-create-token` (no-card ветка)** — гарантировать однозначный маркер источника в `orders_v2.meta`:

- добавить `source: 'trial_no_card'` (или подтвердить, если уже пишется) — этим маркером будет руководствоваться guard в grant-access-for-order.

2.2. `**grant-access-for-order**` — добавить ранний skip-блок ровно по образцу `order_based_only` (~строка 1499) перед `if (existingProductSub) { … } else { CREATE new subscription }`:

```
const isNoCardTrial =
  order.is_trial === true &&
  Number(order.paid_amount || 0) === 0 &&
  (order.meta?.source === 'trial_no_card');

if (isNoCardTrial) {
  // Skip subscriptions_v2 entirely. Entitlement carries trial_end_at.
  await supabase.from('audit_logs').insert({
    action: 'grant.skip_subscription_no_card_trial',
    actor_type: 'system',
    actor_label: 'grant-access-for-order',
    target_user_id: userId,
    meta: { order_id, product_id, offer_id, reason: 'no_card_trial' }
  });
  results.subscription = { action: 'skipped', reason: 'no_card_trial' };
} else if (orderBasedOnly) {
  ...
} else if (existingProductSub) {
  ...
} else {
  // CREATE
}
```

Этот guard:

- **не** трогает existing-subscription extend для другого продукта,
- **не** трогает recurring/pay_now,
- срабатывает только при совпадении всех трёх признаков.

### 3. Dry-run

3.1. На staging-уровне (через `supabase--read_query`) пройти query-эмуляцией: показать, какие `orders_v2` за последние 30 дней попадут под guard, чтобы убедиться, что это только демо-trial.

3.2. Прогнать `tsgo`/линтер на изменённые edge-функции.

### 4. Execute

Деплой `bepaid-create-token` и `grant-access-for-order`. **Никаких** миграций, **никакого** ретроактивного удаления уже существующих trial-sub rows (это backlog: `BACKFILL-CLEANUP-NO-CARD-TRIAL-SUBS` — отдельный безопасный sweep с dry-run, не в этом патче).

### 5. Verify (runtime-proof)

Синтетический прогон через curl `bepaid-create-token` под двумя e-mail:


| Проверка              | Ожидание                                                                         |
| --------------------- | -------------------------------------------------------------------------------- |
| `orders_v2` создан    | 1 строка, `is_trial=true`, `paid_amount=0`, `meta.source='trial_no_card'`        |
| `access_grant_ledger` | 1 grant, `reason_code=paid_order`                                                |
| `entitlements`        | 1 active, `expires_at = paid_at + trial_days`, `meta.tariff_id` присутствует     |
| `subscriptions_v2`    | **0 строк** для этого order_id/user_id                                           |
| `audit_logs`          | `grant.skip_subscription_no_card_trial` присутствует                             |
| Repeat-guard          | 2-й вызов тем же email → `alreadyUsedTrial=true` (по orders_v2, как уже сделано) |
| Regression pay_now    | один заказ → создаётся subscription (как и раньше), guard не сработал            |
| Regression recurring  | оплата recurring-оффера → создаётся sub, guard не сработал                       |


После проверок — синтетика откатывается миграцией-cleanup (как делали для audit-fix).

## DoD

- trial no-card → `orders_v2 +1`, `access_grant_ledger +1`, `entitlements +1`, `**subscriptions_v2 +0**`
- repeat-guard продолжает работать (по orders_v2)
- pay_now и recurring без регрессий (runtime-proof оба)
- audit-row `grant.skip_subscription_no_card_trial` пишется
- сводный отчёт в формате «Отчет о выполнении» с proof

## Out of scope (явно)

- Чистка ранее накопленных trial-sub rows — отдельный `BACKFILL-CLEANUP-NO-CARD-TRIAL-SUBS` (sweep + audit, после согласования списка).
- Изменения resolver-классификатора recurring (`tariff_offers.meta.recurring.is_recurring`) — SOT не трогаем.
- `bepaid-webhook` — no-card trial туда не идёт.