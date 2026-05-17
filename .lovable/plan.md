Да, согласен, с учетом правок:

1. **Сначала code-patch + tests, но без historical execute.**  
Исправление будущего потока — приоритет. Historical repair двух кейсов только после того, как доказано, что webhook реально вызывает `runRebillFlow`.
2. **Не вызывать** `grant-access-for-order` **для H5/repair REBILL, если REBILL-order имеет** `do_not_grant_access=true`**.**  
Для будущих live REBILL — да, canonical writer должен продлевать доступ.  
Для historical repair — осторожно: если доступ уже был продлён старой legacy-веткой, повторный grant может дать дубль/ошибку. Поэтому в dry-run обязательно проверить:

```text
был ли уже продлён access_end_at / entitlement по этому платежу
нужен ли grant вообще
если доступ уже покрыт — REBILL repair только финансовый, без grant
```

3. **Layer 1 и Layer 2 разделить в proof.**  
Не смешивать:
  - `PATCH-RB1` — подключение REBILL flow в `bepaid-webhook/index.ts`;
  - `PATCH-RB2` — repair двух исторических платежей.
4. **Для кейса A сначала восстановить не order, а цепочку ownership.**  
По Юлии Смолик dry-run должен доказать:

```text
provider uid → provider_subscriptions → subscription_v2 → user/profile/product/tariff → expected parent/source order
```

Если parent order отсутствует, REBILL-order можно создать только если хватает данных из subscription/profile/product/tariff/payment. Иначе `manual_review_orphan_parent_missing`.

5. **Для кейса B проверить, был ли доступ уже продлён legacy-путём.**  
У Ольги был `skip_blocked_stale_access`, но нужно проверить фактические `subscriptions_v2.access_end_at` и `entitlements.expires_at`. Если они уже корректны — не дергать grant повторно.
6. **Добавить runtime-env propagation check.**  
В плане есть подозрение, что `BEPAID_REBILL_MATERIALIZATION=on` не доходил до runtime. Нужно явно проверить:

```text
index.ts реально читает secret/env
mode логируется в audit
при on вызывается runRebillFlow
при dry_run пишет dry_run
при off идёт legacy/skip
```

7. **Добавить regression test на конкретный баг.**

Обязательные тесты:

```text
provider-managed subscription charge with existing parent order → creates REBILL-order, not parent update
provider-managed subscription charge with missing tracking order but provider_subscriptions link → recovers via subscription chain
if runRebillFlow succeeds → legacy link_order branch is not executed
if runRebillFlow fails/manual_review → no legacy access date update
BEPAID_REBILL_MATERIALIZATION=on → materialized
BEPAID_REBILL_MATERIALIZATION=dry_run → audit only, no DML
```

8. **Не менять** `subscriptions_v2` **/** `entitlements` **вручную ни в каком слое.**  
Это правильно оставить как hard stop.

## **Текст для Lovable**

```text
План принимаю с правками.

Разделить задачу на два слоя:

PATCH-RB1 — подключение REBILL engine в bepaid-webhook/index.ts для будущих provider-managed repeat charges.
PATCH-RB2 — точечный historical repair двух платежей только после dry-run и отдельного approve.

Правки к плану:

1. Сначала выполнить PATCH-RB1:
- подключить существующий runRebillFlow в реальный bepaid-webhook/index.ts;
- проверить, что BEPAID_REBILL_MATERIALIZATION=on реально приводит к materialized path;
- если runRebillFlow успешно обработал repeat charge, legacy link_order / parent-order branch больше не выполняется;
- если runRebillFlow вернул manual_review/error — не делать fallback на parent-order access writes.

2. Добавить runtime mode proof:
- mode=on читается в runtime;
- audit показывает выбранный режим;
- при on пишется bepaid.rebill.materialized;
- при dry_run пишется bepaid.rebill.dry_run;
- проверить, что secret/env реально доступен внутри deployed function.

3. Regression tests обязательны:
- repeat charge с существующим parent order → создаёт отдельный REBILL-order;
- repeat charge с отсутствующим tracking order, но найденной provider_subscriptions цепочкой → восстанавливается через subscription_v2;
- successful runRebillFlow блокирует legacy branch;
- failed/manual_review runRebillFlow не делает legacy UPDATE access;
- mode on/dry_run/off покрыты тестами.

4. Historical repair двух кейсов не выполнять в этом патче.
Сначала только dry-run proof:
- uid 113f7667… / Юлия Смолик;
- uid 21613f63… / Ольга Черкашина.

5. Для historical repair grant-access-for-order не вызывать автоматически.
Сначала проверить:
- был ли уже продлён subscriptions_v2.access_end_at;
- был ли уже обновлён entitlement.expires_at;
- если доступ уже покрыт legacy-путём — repair только финансовый: create REBILL + repoint payment, без grant;
- если доступ не покрыт — только тогда proposal вызвать grant-access-for-order по новому REBILL/source order, но execute отдельно.

6. По кейсу A / Юлия Смолик:
dry-run должен доказать цепочку:
provider uid → provider_subscriptions → subscription_v2 → user/profile/product/tariff → expected order data.
Если parent/source order не найден и данных недостаточно — manual_review_orphan_parent_missing.

7. По кейсу B / Ольга Черкашина:
dry-run должен показать:
- текущий parent order;
- создаваемый REBILL-order;
- текущий access_end_at/expires_at;
- был ли skip_blocked_stale_access;
- требуется ли grant или только financial repair.

8. Запреты остаются:
- не менять subscriptions_v2 вручную;
- не менять entitlements вручную;
- не менять access_rules;
- не вызывать Telegram/provider API;
- не делать массовый repair;
- не менять secrets/mode без отдельного approve.

Artifacts:
- .lovable/proofs/rebill_materialization_patch_rb1_code_tests_2026_05.md
- .lovable/proofs/rebill_materialization_two_cases_dryrun_2026_05.md

Следующий шаг:
PATCH-RB1 code patch + tests + deploy proof.
Historical execute по двум uid — только после отдельного dry-run и отдельного approve.
```

Коротко: план правильный по сути, но **grant для исторических кейсов нельзя автоматически запускать**. Сначала нужно понять, доступ уже продлён или нет. Future-flow чинить сейчас, historical repair — отдельно и аккуратно.

&nbsp;

План:

## 1. Проблема

Есть повторение старого дефекта: успешные списания по подписке не материализуются в отдельные сделки/заказы.

Затронуты два кейса:


| Кейс | Платёж                        | Клиент                                                          | Продукт                 | Факт                                                                                                                      |
| ---- | ----------------------------- | --------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A    | 100 BYN, 17.05.26 12:15 Minsk | Юлия Смолик / [sm_ulik@mail.ru](mailto:sm_ulik@mail.ru)         | Gorbova Club — CHAT     | webhook получил платёж, но не нашёл `orders_v2` по `tracking_id=link:order:e4cab43a...`; контакт/сделка в UI не связались |
| B    | 250 BYN, 17.05.26 17:00 Minsk | Ольга Черкашина / [holgacher@mail.ru](mailto:holgacher@mail.ru) | Gorbova Club — BUSINESS | платёж записан в `payments_v2`, но привязан к первичной сделке `SUB-26-MO2YQLGECQ2J`, отдельная REBILL-сделка не создана  |


## 2. Диагностика

Факты read-only проверки:

### Кейс A — 100 BYN / 12:15

- `payment_reconcile_queue.id = 4708a0f9-37e6-4aab-b585-f4ba21d3c82c`
- `bepaid_uid = 113f7667-369c-4cb2-8c88-c2b92bb854da`
- `tracking_id = link:order:e4cab43a-c90b-4e26-8523-c2215bcb8267`
- `status = pending`, `processed_order_id = NULL`
- `orders_v2` по `e4cab43a...` сейчас не найден.
- В `audit_logs` есть `bepaid.webhook.link_order_not_found` по этому `order_id`.
- Provider subscription найден: `sbs_c8aa1cf60778cdf6` → `subscription_v2_id = eaeb666b-11d3-4204-bef8-bb72fca78743` → профиль Юлия Смолик, Gorbova Club CHAT.

### Кейс B — Ольга Черкашина / 250 BYN

- `payments_v2.id = 4a9288d3-d2b1-4bc0-984a-8900d1664da3`
- `provider_payment_id = 21613f63-dc85-406f-a8dd-34a936bc0784`
- Платёж привязан к первичному `orders_v2.id = 57fcc9d8-a665-48a6-9fba-312c535be5a8` / `SUB-26-MO2YQLGECQ2J`.
- Отдельного `REBILL-*` заказа по этому списанию нет.
- `grant-access-for-order` запускался по первичному старому order и получил `skip_blocked_stale_access`; это подтверждает, что повторное списание пошло не через отдельный REBILL-order.

### Кодовая причина

В проекте уже есть готовый REBILL engine:

- `supabase/functions/bepaid-webhook/rebill_flow.ts`
- `supabase/functions/bepaid-webhook/rebill_builders.ts`
- тесты `rebill_*_test.ts`

Но `bepaid-webhook/index.ts` фактически не вызывает `runRebillFlow`: поиск по `runRebillFlow / resolveKillSwitchMode / BEPAID_REBILL_MATERIALIZATION` в `index.ts` не нашёл подключения. Поэтому webhook продолжает legacy-поведение: использует первичный `order_id` из `tracking_id`, а не создаёт отдельную REBILL-сделку.

## 3. Предлагаемое решение

Сделать PATCH в два слоя.

### Layer 1 — исправить поток для будущих повторных списаний

Подключить существующий `runRebillFlow` в `bepaid-webhook/index.ts` для успешных provider-managed subscription charges:

- если событие является повторным списанием подписки;
- если есть `transactionUid` / `last_transaction.uid`;
- если есть parent order или его можно восстановить через `provider_subscriptions.subscription_v2_id → subscriptions_v2.order_id`;
- создать отдельный `orders_v2` с `order_number = REBILL-<uid>`;
- связать `payments_v2.order_id` с новым REBILL-order;
- вызвать `grant-access-for-order` только по новому REBILL-order;
- legacy-ветку не запускать, если REBILL обработан.

### Layer 2 — точечный repair двух исторических кейсов

Только после отдельного dry-run и approve:

- для `21613f63-dc85-406f-a8dd-34a936bc0784` создать/дозавершить REBILL-order для Ольги Черкашиной;
- для `113f7667-369c-4cb2-8c88-c2b92bb854da` создать/дозавершить REBILL-order для Юлии Смолик;
- не делать ручных правок `subscriptions_v2.access_*` и `entitlements`;
- все доступы — только через `grant-access-for-order`.

## 4. Изменяемые компоненты

Планируемые файлы:

- `supabase/functions/bepaid-webhook/index.ts` — подключение REBILL flow в реальный dispatcher webhook.
- `supabase/functions/bepaid-webhook/rebill_flow.ts` — только если потребуется адаптер/guard для orphan recovery; без изменения SOT.
- `supabase/functions/bepaid-webhook/rebill_builders.ts` — только если dry-run покажет, что REBILL payload не переносит нужный CRM snapshot для отдельной сделки.
- `supabase/functions/bepaid-webhook/rebill_*_test.ts` — добавить regression cases.
- `.lovable/proofs/rebill_materialization_dryrun_2026_05.md`
- `.lovable/proofs/rebill_materialization_execute_2026_05.md`

Таблицы, которые будут читаться:

- `payment_reconcile_queue`
- `payments_v2`
- `orders_v2`
- `subscriptions_v2`
- `provider_subscriptions`
- `profiles`
- `products_v2`
- `tariffs`
- `audit_logs`

Таблицы, которые могут быть изменены только после approve execute:

- `orders_v2` — создание отдельных REBILL-order.
- `payments_v2` — привязка платежа к REBILL-order.
- `payment_reconcile_queue` — отметка `processed_order_id` для восстановленного orphan.
- `audit_logs` — системный trace.

## 5. Что не будет изменено

- Не менять `subscriptions_v2` вручную.
- Не менять `entitlements` вручную.
- Не менять `access_rules`.
- Не создавать контакты вручную, если профиль уже существует.
- Не создавать второй writer для доступа.
- Не вызывать Telegram/API/провайдера напрямую.
- Не делать массовый repair по всем подпискам — только два подтверждённых кейса после dry-run.

## 6. Dry-run

Перед execute подготовить proof с таблицей:


| uid           | клиент          | продукт                 | parent_order                                  | planned_rebill_order_number | planned action                          | stop-guard                             |
| ------------- | --------------- | ----------------------- | --------------------------------------------- | --------------------------- | --------------------------------------- | -------------------------------------- |
| `113f7667...` | Юлия Смолик     | Gorbova Club — CHAT     | восстановить через `subscription_v2.order_id` | `REBILL-113f7667-369`       | create REBILL + link payment + grant    | stop если нет parent/sub/profile       |
| `21613f63...` | Ольга Черкашина | Gorbova Club — BUSINESS | `57fcc9d8...`                                 | `REBILL-21613f63-dc8`       | create REBILL + repoint payment + grant | stop если payment уже у другого REBILL |


Dry-run должен подтвердить:

- сколько REBILL-order уже существует по этим uid;
- куда сейчас смотрит каждый `payments_v2.order_id`;
- есть ли `profile_id`, `product_id`, `tariff_id`, `offer_id`;
- какой `crm_routing_snapshot` будет у новой сделки;
- какой `grant-access-for-order` будет вызван;
- ожидаемый rowcount: максимум 2 REBILL-order.

## 7. Execute

Execute только после отдельного подтверждения.

Последовательность:

1. Применить code PATCH, который подключает существующий REBILL flow в webhook.
2. Прогнать regression tests для `bepaid-webhook`.
3. Сделать dry-run historical repair по двум uid.
4. После approve выполнить repair через canonical REBILL path.
5. Для каждого кейса после создания REBILL-order вызвать `grant-access-for-order`.
6. Если writer вернул `error/manual_review/sbs_mismatch/skip_*` — остановиться, не чинить вручную.

## 8. STOP-guards

Остановиться без execute, если:

- найдено больше 2 затронутых historical uid;
- REBILL-order уже есть, но указывает на другого клиента/продукт/тариф;
- `payments_v2.provider_payment_id` связан с чужим order не из этого repair;
- не найден `profile_id` или parent subscription/order;
- `grant-access-for-order` возвращает skip/error/manual_review;
- потребуется UPDATE `subscriptions_v2.access_*` или ручной INSERT/UPDATE `entitlements`;
- dry-run не может доказать product/tariff через UUID.

## 9. DoD

Задача считается выполненной, когда:

- будущие repeat charges идут через отдельный REBILL-order, а не через первичную сделку;
- по Ольге Черкашиной появляется отдельная REBILL-сделка для платежа 250 BYN от 17.05.26;
- по платежу 100 BYN от 12:15 появляется связанная REBILL-сделка с восстановленным клиентом/продуктом;
- `payments_v2.order_id` для обоих uid указывает на соответствующие REBILL-order;
- `orders_v2` не склеивает новые списания с первичной сделкой;
- `subscriptions_v2` и `entitlements` не изменялись вручную;
- `grant-access-for-order` был единственным write-path для доступа;
- proof-файл содержит SQL-подтверждения rowcount и audit trail.

## 10. Риски и зависимости

- Кейс A использует legacy/orphan `tracking_id` на удалённый/отсутствующий order; восстановление возможно только через provider/subscription chain.
- Для Ольги текущая первичная сделка уже была обновлена webhook’ом 17.05; repair должен быть add-only и не ломать историю.
- Если текущий `rebill_builders.ts` переносит terminal stage первичной сделки, может потребоваться отдельный CRM snapshot guard, чтобы новая REBILL-сделка корректно отображалась как самостоятельная оплаченная сделка.
- Нужна отдельная проверка, почему `BEPAID_REBILL_MATERIALIZATION` engine был написан, но не подключён в `index.ts`.

## 11. Требуется дополнительная информация

Не требуется для следующего шага. Следующий безопасный шаг — подготовить PATCH + dry-run proof без изменения данных.