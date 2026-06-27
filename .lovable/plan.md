## да, согласен, с учетом правок:

1. **В плане есть противоречие по** `grant-access-for-order`

В Scope написано:

```text
без вмешательства в core write-path grant-access-for-order
```

Но в шаге 3 предлагается вставка внутрь `grant-access-for-order`.

Нужно зафиксировать один вариант.

Допустимый вариант для Execute:

```text
Вставка допускается только как post-success tail-hook после полного успешного grant lifecycle, без изменения grant-логики, без влияния на return/status основного grant, с try/catch и best-effort semantics.
```

То есть:

- не менять существующие grant-ветки;
- не менять access logic;
- не менять error handling основного grant;
- не вызывать convert до завершения grant;
- convert failure не меняет результат grant.

Если это невозможно технически гарантировать — не трогать `grant-access-for-order`, а вызывать convert из writer/caller после успешного ответа grant.

2. **Edge function** `preorder-convert-on-pay` **не делать в этом патче без необходимости**

Сейчас для Phase B достаточно:

```text
RPC convert_preorder_on_pay_atomic
+
post-success best-effort вызов RPC
```

Edge-функция для manual repair/reconcile — отдельный follow-up, если понадобится.

Иначе появится лишний surface:

- registry;
- verify_jwt;
- service-role invocation;
- отдельная auth-модель;
- отдельные логи.

В этом Execute лучше убрать шаг 2 или пометить как out of scope.

3. `GRANT EXECUTE только service_role` **— проверить реальную роль**

В Supabase/Postgres не всегда корректно полагаться на `GRANT EXECUTE TO service_role` без проверки.

В миграции сделать явно:

```sql
REVOKE ALL ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) FROM authenticated;
```

И только если роль доступна:

```sql
GRANT EXECUTE ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) TO service_role;
```

Если `service_role` не grantable в окружении — функция должна вызываться через service-role SQL/API, но публичный execute для `anon/authenticated` не давать.

4. `p_user_id` **в Phase B RPC не нужен**

`convert_preorder_on_pay_atomic(p_paid_order_id uuid)` не должен принимать `p_user_id`.

Матчинг делается по уже сохранённому paid order:

```text
paid_order.user_id
paid_order.customer_email
paid_order.product_id
```

Никаких identity-полей из payload.

5. **course_preregistrations update не должен быть “ошибка не валит транзакцию” внутри атомарной RPC без audit**

Если `course_preregistrations` update падает, а `orders_v2` linkage уже записан, это допустимо, но нужно логировать warning.

Лучше:

- linkage `orders_v2` — основной atomic effect;
- `course_preregistrations.status='converted'` — best-effort внутри exception block;
- exception пишет `audit_logs` или `domain_executions` warning;
- return содержит:

```json
{
  "preregistration_update": "ok|failed|not_found"
}
```

6. **Идемпотентность: audit не должен дублироваться**

В DoD написано:

```text
повторный вызов RPC → noop, никаких новых audit_logs
```

Это правильно. В RPC явно сделать:

- audit только при первой успешной конверсии;
- no-op без новой audit-записи;
- no-match без audit или только debug/domain execution, если нужно.

7. **Поиск preorder: добавить временное окно**

Сейчас поиск берёт все draft preorder по email/product.

Добавить ограничение:

```text
preorder.created_at <= paid_order.created_at
preorder.created_at >= paid_order.created_at - interval '90 days'
```

Если 90 дней не подходит — вынести в константу, но окно должно быть. Иначе можно связать слишком старую заявку.

8. **Множественные preorder**

План говорит earliest-wins, но не описывает остальные.

Для Phase B Execute минимально:

- конвертировать только один earliest preorder;
- остальные не трогать;
- в return добавить `other_matching_preorders_count`.

Не помечать остальные как superseded в этом патче, чтобы не расширять side effects.

9. **CRM UI hide: лучше server-side + fallback**

Default-фильтр должен исключать:

```text
status='draft'
AND meta.is_preorder=true
AND meta.converted_to_order_id IS NOT NULL
```

Если PostgREST-синтаксис сложный, допустим временный client-side fallback, но в отчёте нужно явно указать, где именно фильтр стоит.

Важно: фильтр не должен скрывать обычные draft-заказы, только converted preorder.

10. **Не добавлять** `preorder-convert-on-pay` **в registry, если edge не создаётся**

Пункт:

```text
Registry: добавить preorder-convert-on-pay
```

убрать, если Edge function не реализуется в Phase B.

11. **Failure isolation proof уточнить**

Не надо симулировать ошибку через отзыв `GRANT EXECUTE` в production/staging, если это рискованно.

Достаточно безопасного способа:

- временно вызвать RPC с невалидным paid_order_id → no-op/error не ломает grant;
- или замокать/отключить convert call локально;
- или проверить try/catch path unit/runtime log.

Не ломать реальные GRANT/permissions ради proof.

12. **Proof по** `access_grants`

В таблицах proof использовать реальные названия проекта. Ранее фигурировали:

```text
access_grant_ledger
entitlements
telegram_access_grants
telegram_access_queue
```

В отчёте показать count до/после именно по существующим таблицам. Не писать абстрактно `access_grants`, если такой таблицы нет.

13. **Memory update не делать через код**

Пункт:

```text
Memory update после PASS
```

оставить как текстовую фиксацию в отчёте, не как техническую задачу подрядчика. Он не должен пытаться писать в `mem://`.

14. **Финальный отчёт**

Заголовок:

```text
Отчет о выполненной работе: PATCH-PREORDER-DEAL-FLOW Phase B
```

Статусные строки:

```text
RPC convert_preorder_on_pay_atomic: PASS
Post-grant best-effort hook: PASS
Idempotency: PASS
No payments/subscriptions/access grants: PASS
CRM hide converted preorder: PASS
Grant lifecycle unaffected: PASS
PATCH-PREORDER-DEAL-FLOW Phase B: PASS/PARTIAL/FAIL
```

После этих правок план можно выполнять.

&nbsp;

План: PATCH-PREORDER-DEAL-FLOW Phase B — Execute

### Scope

Связать paid order с ранее созданным preorder-deal после успешной выдачи доступа, без триггеров и без вмешательства в core write-path `grant-access-for-order`. Конверсия — best-effort, идемпотентная, не влияет на оплату/grant/подписки/доступы.

### Принятые ограничения (из ревью discovery)

- Variant A: linkage через `meta.converted_to_order_id` / `meta.converted_from_preorder_id`. Preorder остаётся `status='draft'`.
- Match по `product_id` (не по `tariff_id`).
- `AFTER UPDATE OF status` trigger — НЕ используется.
- Конверсия вызывается ТОЛЬКО после успешного `grant-access-for-order`.
- Любая ошибка конверсии не откатывает оплату и не откатывает grant.
- Повторный вызов — no-op.
- `payments_v2`, `subscriptions_v2`, `access_grants`, `entitlements`, `access_rules` — не трогаются ни прямо, ни косвенно.
- `grant-access-for-order` не пере-вызывается.
- Variant C запрещён, новый enum/status не вводится.

---

### Шаг 1. Миграция: RPC `convert_preorder_on_pay_atomic`

`public.convert_preorder_on_pay_atomic(p_paid_order_id uuid) returns jsonb`

- `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`.
- `GRANT EXECUTE` только `service_role` (вызывается из edge function под service-role клиентом). Никаких grant для `anon`/`authenticated`.

Поведение (строгий порядок, всё в одной транзакции):

1. **Загрузить paid order** `FOR UPDATE`:
  - не найден → `{ok:false, reason:'paid_order_not_found'}`.
  - `status <> 'paid'` → `{ok:false, reason:'paid_order_not_paid'}`.
  - `meta->>'is_preorder' = 'true'` → `{ok:false, reason:'paid_order_is_preorder'}`.
  - `product_id IS NULL` → `{ok:false, reason:'paid_order_no_product'}`.
  - `customer_email IS NULL AND user_id IS NULL` → `{ok:false, reason:'paid_order_no_identity'}`.
2. **Идемпотентность (early exit)**:
  - если `meta ? 'converted_from_preorder_id'` — вернуть `{ok:true, noop:true, preorder_order_id: <existing>}`.
3. **Поиск preorder** (earliest-wins, только активные draft preorders):
  - базовый фильтр: `status='draft' AND product_id = paid.product_id AND meta->>'is_preorder'='true' AND (meta ? 'converted_to_order_id') = false`.
  - сначала по `user_id` (если у paid order есть user_id);
  - если не найдено — по `lower(email_normalized) = lower(paid.customer_email)`;
  - `ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`.
  - не найдено → `{ok:true, noop:true, reason:'no_matching_preorder'}` (это валидный кейс: купил без предзаписи).
4. **Race-guard**: повторная проверка `(preorder.meta ? 'converted_to_order_id') = false` после lock. Иначе `noop:true, reason:'preorder_already_converted'`.
5. **Атомарная запись**:
  - `UPDATE orders_v2 SET meta = meta || jsonb_build_object('converted_to_order_id', p_paid_order_id, 'converted_at', now()) WHERE id = preorder.id;`
  - `UPDATE orders_v2 SET meta = meta || jsonb_build_object('converted_from_preorder_id', preorder.id, 'converted_at', now()) WHERE id = p_paid_order_id;`
  - `UPDATE course_preregistrations SET status='converted', updated_at=now() WHERE id = preorder.meta->>'preregistration_id' AND status <> 'converted';` (best-effort, ошибка не валит транзакцию — wrap в `BEGIN/EXCEPTION`).
6. Запись в `audit_logs` (action `preorder.convert_on_pay`, actor='system', meta содержит оба order_id, matched_by ∈ {user_id,email}).
7. Return `{ok:true, preorder_order_id, paid_order_id, matched_by}`.

### Шаг 2. Edge function `preorder-convert-on-pay`

Новая функция (registry-only до approval execute):

- `verify_jwt = true`, вызывается ВНУТРЕННЕ из `grant-access-for-order` через service-role invoke (или прямой `supabase.rpc` тем же service клиентом — предпочтительно, без сетевого hop).
- Принимает `{ paid_order_id: uuid }`, Zod валидация.
- Вызывает RPC, любую ошибку логирует в `domain_executions` (kind=`preorder_convert_on_pay`) и НЕ пробрасывает наверх.

Решение по транспорту будет финализировано в начале execute: предпочтение — прямой вызов RPC из `grant-access-for-order` (меньше surface, меньше latency), edge function оставляем для ручных reconcile/repair.

### Шаг 3. Интеграция в `grant-access-for-order`

Минимальная точечная вставка в самый конец успешной ветки, после фиксации всех grant-side эффектов:

```ts
// best-effort, isolated, never throws
try {
  await supabaseService.rpc('convert_preorder_on_pay_atomic', { p_paid_order_id: orderId });
} catch (e) {
  await recordExecution('preorder_convert_on_pay', 'error', { order_id: orderId, error: String(e) });
}
```

Условия вызова:

- только если основной grant lifecycle вернул success;
- только для НЕ-preorder заказов (skip если `order.meta.is_preorder === true`);
- никакого `await` внутри транзакции grant; вызов после commit.

### Шаг 4. CRM UI: скрыть converted preorders

В `useDealsFilters.ts` / запросе доски `AdminDeals` / `AdminOrdersV2.tsx`:

- default-фильтр исключает строки, где `status='draft' AND meta->>'is_preorder'='true' AND meta ? 'converted_to_order_id'`.
- Добавить чекбокс «Показать конвертированные предзаписи» (off by default) в `DealsFiltersBar`, по аналогии с `includeSynthetic`.
- Серверный фильтр (PostgREST `.not('meta->converted_to_order_id', 'is', null)` инверсия) — точная форма проверяется в начале execute, fallback клиентский filter допустим, если PostgREST синтаксис окажется неудобным.

Никаких изменений в summary metrics: paid order и так единственный revenue, preorder уже исключён из revenue/purchased.

### Шаг 5. Proof / DoD

Dry-run перед execute:

- ручной вызов RPC в `(paid_order_id, preorder_order_id)` фикстуре staging-данных через `supabase--read_query` (read-only verification после insert через миграцию-фикстуру в test-окружении не делаем — только проверка результата RPC на реальном последнем тестовом paid order, если такой найдётся).

После execute проверить:

1. **Linkage**: paid order имеет `meta.converted_from_preorder_id`, preorder — `meta.converted_to_order_id`. SQL select подтверждает.
2. **Идемпотентность**: повторный вызов RPC на тот же `paid_order_id` → `{ok:true, noop:true}`. Никаких новых записей в `audit_logs`.
3. **Изоляция grant**: `payments_v2`, `subscriptions_v2`, `access_grants`, `entitlements`, `access_rules`, `provider_subscriptions` — count до/после конверсии идентичен.
4. **Grant не повторяется**: `domain_executions` для `grant_access_for_order` по этому order_id — ровно одна успешная запись.
5. **CRM hide**: converted preorder отсутствует в default Kanban и default списке `/admin/crm/deals`; появляется при включённом «Показать конвертированные предзаписи».
6. **No-match safety**: paid order без матчящегося preorder → `{ok:true, noop:true, reason:'no_matching_preorder'}`, ничего не пишется.
7. **Failure isolation**: симулировать ошибку конверсии (например, кратковременный отзыв GRANT EXECUTE) → оплата и grant остаются успешными, запись в `domain_executions` со статусом error.
8. **course_preregistrations**: связанная запись (если есть) переходит в `status='converted'`; отсутствие записи не валит конверсию.

### Технические детали

- Match priority: `user_id` > `lower(email)`, earliest-wins по `created_at ASC`.
- `FOR UPDATE SKIP LOCKED` чтобы параллельные оплаты двух разных продуктов не блокировались.
- Никаких изменений в `tariff_offers`, `crm_routing`, enum `orders_v2.status`.
- Registry: добавить `preorder-convert-on-pay` в `supabase/functions.registry.txt` (P1 секция) одновременно с миграцией.
- Memory update после PASS: краткая запись `mem://commercial-logic/orders/preorder-convert-on-pay-v1` с правилами matching и идемпотентности.

### Out of scope (Phase B Execute)

- Backfill исторических paid orders без preorder linkage — отдельная задача, если понадобится.
- Reconcile-функция для ручного матчинга по UI — отдельная задача.
- Любое изменение `grant-access-for-order` сверх одного best-effort вызова в конце.