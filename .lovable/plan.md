да, согласен, с учетом правок:

1. **Критичный конфликт по** `do_not_grant_access=true`**.**  
В spec написано:
  - REBILL-order создается с `meta.do_not_grant_access=true`;
  - затем вызывается `grant-access-for-order(order_id = parent_order.id, source_payment_uid=uid)`;
  - доступ продлевается через parent-order.
  Это архитектурно опасно: один и тот же `parent_order.id` уже был обработан при первичной покупке. Повторный вызов grant по parent-order может быть заблокирован идемпотентностью, либо, наоборот, продлить доступ не от финансового REBILL-order. Нужно в spec явно доказать, что существующий `grant-access-for-order(parent_order.id, source_payment_uid=uid)` умеет recurring extend по `source_payment_uid`, а не считает это повторной обработкой initial-order.
  Если такого контракта нет — правильнее делать отдельный `REBILL-order` как финансовый source для extend, но с guard против double-grant при full-refund. Сейчас модель «финансовый учёт = REBILL, доступ = parent» требует отдельного доказательства.
2. **Нужно проверить legacy-контракт** `rebill_orders_materialization_2026`**.**  
В плане указано, что `do_not_grant_access` уже использовался в migration `rebill_orders_materialization_2026`. В §A proof нужно добавить:
  - где именно этот контракт описан;
  - как раньше продлевался доступ;
  - был ли вызов grant по parent-order;
  - не ломает ли это `domain_events`, `access_grant_ledger`, `extended_by_orders`.
3. `provider_payment_id` **в** `orders_v2` **нужно подтвердить схемой.**  
В spec указано поле `orders_v2.provider_payment_id = uid`. Нужно проверить, что такое поле реально существует. Если нет — хранить только в `meta.source_payment_uid` и не писать несуществующее поле.
4. **Partial UNIQUE** `idx_orders_v2_provider_payment_unique` **нужно подтвердить в текущей БД.**  
В spec нельзя ссылаться только на старый proof. В текущий §A dry-run добавить:
  - имя индекса;
  - DDL индекса;
  - условие partial index;
  - какие поля реально покрывает;
  - что он применим именно к bePaid REBILL-order.
5. `order_number = REBILL-<first12(provider_payment_id)>` **может конфликтовать с текущим паттерном.**  
Ранее использовался паттерн `REBILL-7a64cd04-3d0` / `REBILL-0e530a8c-3eb`. Нужно выбрать один стандарт. Рекомендация: оставить текущий production-паттерн, иначе появятся два формата REBILL-номеров.
6. `parent_order_id` **нельзя определять только через** `subscriptions_v2.bepaid_subscription_id`**.**  
Нужно прописать точный resolver:
  - найти `subscription_v2` по `bepaid_subscription_id`;
  - из неё определить canonical initial/root order;
  - если есть `origin_order_id`, использовать его;
  - если есть `order_id`, использовать его;
  - если несколько кандидатов — STOP/manual_review;
  - не использовать `user+product fallback`.
7. **Статус** `refunded` **для REBILL-order нужно проверить с enum и UI.**  
В plan указано `status='paid' | 'refunded'`. В §A dry-run нужно подтвердить:
  &nbsp;
  - `orders_v2.status` поддерживает `refunded`;
  - `DealDetailSheet`;
  - списки сделок;
  - фильтры по статусам;
  - статистика продаж  
  корректно работают с `refunded`.
8. **Refund в той же транзакции нужно отделить от отдельного refund webhook.**  
В bePaid обычно payment и refund могут приходить разными webhook-событиями. В spec нужно не предполагать “same transaction”, а описать два отдельных сценария:
  - payment webhook materializes REBILL;
  - refund webhook later resolves parent payment and updates REBILL.
9. `record_refund_atomic` **должен работать с REBILL-order без миграций.**  
В §A proof добавить сигнатуру RPC и подтвердить:
  - принимает ли `order_id`;
  - обновляет ли parent payment;
  - обновляет ли order status/meta;
  - idempotent ли по refund uid;
  - не требует новых колонок.
10. **Kill-switch default** `off` **правильный, но нужен режим dry-run/log-only.**  
Добавить третий режим:

&nbsp;

- `off` — старый путь;
- `dry_run` — не меняет write-path, но логирует, какой REBILL был бы создан;
- `on` — новый path.  
Это безопаснее для production rollout.

11. **STOP-condition “дубль REBILL → ROLLBACK + audit + 500” лучше заменить.**  
Дубль по uid при повторном webhook — нормальный idempotency-сценарий, не 500.  
Правильно:

- если найден существующий REBILL по тому же uid и параметры совпадают → skip 200 + audit;
- если найден конфликтующий REBILL по тому же uid с другими user/product/amount/sbs → STOP/manual_review.

12. **Нельзя обещать ROLLBACK внутри webhook без транзакционной оболочки.**  
Если будущий code-patch будет делать несколько операций, нужен один атомарный RPC/helper или четкая компенсация. В spec добавить:

- какие операции должны быть atomic;
- что происходит, если order создан, а payment insert упал;
- как повторный webhook завершит materialization.

13. `grant-access-for-order` **должен иметь full-refund guard.**  
Даже если REBILL не вызывает grant напрямую, в spec нужно закрепить будущий общий guard:

- `paid_amount <= refunded_amount`;
- `meta.refunded_in_full=true`;
- `status='refunded'`;  
→ no extend/no grant.

14. **Dry-run метрики недостаточны.**  
Добавить:

- сколько payments сейчас уже mis-linked к initial-order с `rn > 1`;
- сколько уже имеют отдельный REBILL;
- сколько имеют refund;
- сколько имеют provider uid без order-level provider uid;
- сколько не имеют resolvable parent subscription;
- список edge-cases с row ids.

15. **В §A inventory добавить точный call graph.**  
Не только строка в `bepaid-webhook`, а:

- где webhook получает payload;
- где определяется recurring;
- где резолвится subscription/order;
- где создается/обновляется payment;
- где вызывается grant;
- где пишется audit.

16. **В proof добавить “no-loss mapping” для старого и нового path.**  
Таблица:

- old path: payment → parent order;
- new path: payment → REBILL order;
- old grant behavior;
- new grant behavior;
- old refund behavior;
- new refund behavior.

17. **§F нельзя откладывать слишком далеко.**  
Так как в 3.1 уже подтверждено нарушение `tariffMatch && !sbsMatch → создаётся новая sub`, §F является критичным root-bug. Его можно делать отдельным approve, но он должен идти **до включения REBILL materialization в production**.
18. **DoD §A добавить:**

- подтверждено, что spec не требует DML/миграций/кода;
- подтвержден текущий индекс/idempotency;
- подтвержден parent-order resolver;
- подтвержден grant-contract или зафиксирован blocker;
- подтверждены dry-run цифры и edge-cases;
- отдельно указан риск `do_not_grant_access + parent_order grant`.

После этих правок можно выполнять §A как **spec + read-only dry-run**.

&nbsp;

План: Этап 3.2 §A — REBILL Materialization Spec

## Контекст

Уточнение по 3.1 уже зафиксировано в proof (раздел 9): при `tariffMatch && !sbsMatch` сейчас всё ещё создаётся новая sub-цепочка — это нарушение. Патч вынесен в **§F** настоящего плана. §A — основной риск, поэтому начинаем с него отдельно.

§A исправляет первопричину дефекта Ларисы на уровне canonical write-path: каждый bePaid autocharge должен материализоваться как **отдельный `orders_v2**`, а не дописываться платежом в parent-order. Это устраняет «два платежа в одну сделку», смещение `deal_date` и mis-attributed refunds.

§A — это **только spec + dry-run артефакт**. Никакого кода в этой итерации. Code-patch — отдельным approve после принятия spec.

## Цели §A

1. Описать схему canonical write-path для recurring autocharge внутри `bepaid-webhook`.
2. Описать идемпотентность по `provider_payment_id` + `meta.materialized_from_payment_uid`.
3. Описать поведение при full-refund в той же транзакции (do_not_grant_access guard).
4. Описать связь с `grant-access-for-order` и почему extend по subscription остаётся валидным.
5. Описать rollback / kill-switch (env-флаг для постепенного включения).
6. Подготовить dry-run скрипт (read-only SQL) — сколько rebill-платежей за окно [последние 30 дней] попало бы под материализацию, distribution, edge-cases.

## Что НЕ входит в §A

- §B duplicate guard live-check
- §C DealDetailSheet UI
- §D regression tests
- §E getEffectiveDealDate callsites audit
- §F SBS-mismatch no-new-sub patch (отдельным approve)
- Любые миграции, любой DML, любые правки кода `bepaid-webhook`/`grant-access-for-order`

## Артефакты §A

Создать `.lovable/proofs/inv_rebill_materialization_spec_2026_05.md` со следующими разделами:

### 1. Spec нового write-path

```text
recurring webhook (is_recurring=true && parent_uid != null)
        │
        ├─ idempotency check по provider_payment_id  ──► already_materialized → skip
        │
        ├─ resolve parent_order по subscriptions_v2.bepaid_subscription_id
        │       (НЕ по link_order, НЕ по user+product fallback)
        │
        ├─ pre-cap расчёт net_amount = paid_amount - sum(refunds_in_same_notif)
        │
        ├─ INSERT orders_v2 REBILL-order:
        │       order_number      = REBILL-<first12(provider_payment_id)>
        │       user_id/profile_id/product_id/tariff_id ← copy из parent_order
        │       provider          = 'bepaid'
        │       provider_payment_id = uid
        │       bepaid_subscription_id = parent_order.bepaid_subscription_id
        │       status            = 'paid' | 'refunded' (если net=0)
        │       paid_amount       = full
        │       deal_date         = paid_at
        │       pipeline_id/stage = copy из parent
        │       meta = {
        │         payment_flow: 'bepaid_subscription_charge',
        │         source: 'rebill_materialization_v2_runtime',
        │         parent_order_id, parent_subscription_v2_id,
        │         materialized_from_payment_uid: uid,
        │         materialization_run: 'webhook_runtime',
        │         deal_month: YYYY-MM (Europe/Minsk),
        │         do_not_grant_access: true   ← ключевой guard
        │       }
        │
        ├─ INSERT payments_v2 с order_id = REBILL.id (НЕ parent.id)
        │
        ├─ call grant-access-for-order(order_id = parent_order.id, source_payment_uid=uid)
        │       — extend по subscription идёт от parent_order_id, а не от REBILL
        │       — REBILL-order имеет do_not_grant_access=true → grant пропускает его
        │       — финансовый учёт = REBILL, доступ = parent + subscriptions_v2
        │
        └─ audit: bepaid.webhook.rebill_order_materialized
                  + bepaid.webhook.rebill_skipped_already_materialized (idempotency)
```

### 2. Идемпотентность

- Главный ключ: `(provider='bepaid', provider_payment_id=uid)` через partial UNIQUE `idx_orders_v2_provider_payment_unique` (уже существует, см. proof rebill_orders_dryrun_2026.md §UNIQUE).
- Доп. защита: lookup по `meta->>'materialized_from_payment_uid'` перед INSERT.
- При повторном webhook'е тот же uid → SELECT возвращает существующий REBILL → skip с audit `rebill_skipped_already_materialized`.
- Конфликт `(provider, provider_payment_id)` (race) → 23505 → переход в SELECT-ветку.

### 3. Refund в той же транзакции

- Если webhook содержит и `paid_amount > 0`, и `refund > 0` (full-refund flow):
  - Создаём REBILL `status='refunded'`, `paid_amount=full`, `meta.refunded_in_full=true`;
  - `payments_v2` платёж + refund-row пишутся через **существующий** `record_refund_atomic` с `order_id = REBILL.id`;
  - parent_order не трогается (он остаётся `paid` со своими старыми платежами).
- Если refund приходит **отдельным** webhook позже:
  - Resolve parent payment по `provider_payment_id`, `record_refund_atomic` с `order_id = REBILL.id` (где REBILL.id = parent payment.order_id, уже relinked при materialization).

### 4. Связь с grant-access-for-order

- REBILL-order содержит `meta.do_not_grant_access=true`. Существующий guard в `grant-access-for-order` (строки выше 200) уже умеет пропускать такие ордера (использовался в migration `rebill_orders_materialization_2026`).
- Доступ продлевает старый код-path: `grant-access-for-order(order_id=parent_order.id)` → extend по `subscriptions_v2` через GREATEST.
- Telegram grant идёт ровно один раз через canonical path (memory: canonical-grant-write-path).

### 5. Kill-switch / постепенный rollout

- env-флаг `BEPAID_REBILL_MATERIALIZATION=on|off` (default `off` до approve);
- при `off` — старый путь (writes payment в parent_order), как сейчас;
- при `on` — новый write-path;
- audit пишет фактический режим в `meta.write_path_mode`;
- production включение — отдельным approve после §A code-patch + регресс-тестов §D.

### 6. Dry-run read-only анализ

Read-only SQL отчёт за окно [сейчас − 30 дней; сейчас]:


| Метрика                                                                                     | Источник                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Кол-во recurring `payments_v2` (`provider='bepaid'`, есть `bepaid_subscription_id` у order) | payments_v2 + orders_v2              |
| Из них «не первый платёж» в своём ордере (rn > 1 по paid_at, id)                            | window function                      |
| Распределение по `deal_month (Minsk)`                                                       | aggregation                          |
| Дубликаты `provider_payment_id` (должно быть 0)                                             | groupby having count>1               |
| Кейсы full-refund в той же сделке                                                           | payments_v2.refunded_amount = amount |


Цель — подтвердить, что схема покрывает реальный поток без сюрпризов.

### 7. Inventory изменений (для будущего code-patch §A)

Файл `supabase/functions/bepaid-webhook/index.ts`:

- Блок recurring autocharge (определить точные строки в spec);
- Точка вставки materialization до `payments_v2` insert;
- Точка вставки `do_not_grant_access` в meta нового ордера;
- Точка вызова `grant-access-for-order` — без изменений (passes parent_order_id).

Никаких изменений в `grant-access-for-order`, `subscriptions_v2`, `entitlements`, миграциях.

### 8. STOP-условия (если при code-patch обнаружится)

- Дубль REBILL по тому же uid → ROLLBACK + audit + 500;
- `subscriptions_v2.access_end_at` уменьшилось по сравнению с pre-call → ROLLBACK;
- `entitlements.expires_at` уменьшилось → ROLLBACK;
- REBILL без parent_order_id в meta → ROLLBACK;
- `do_not_grant_access` отсутствует в REBILL meta → ROLLBACK.

### 9. DoD §A (этой итерации)

- Файл `.lovable/proofs/inv_rebill_materialization_spec_2026_05.md` создан со всеми разделами выше.
- Read-only dry-run отчёт встроен в раздел 6 с реальными цифрами.
- Запреты соблюдены: 0 DML, 0 миграций, 0 правок кода, Лариса не трогается.
- §F (SBS-mismatch no-new-sub) явно вынесен в отдельный approve.

## Запреты

- Не править `bepaid-webhook/index.ts` в этой итерации.
- Не править `grant-access-for-order/index.ts` в этой итерации (включая §F).
- Не создавать миграций.
- Не трогать `payments_v2`, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `telegram_*` через DML.
- Не повторять data-repair Ларисы.

## Следующий шаг после approve

Выполнить spec + dry-run, отдать артефакт. После принятия §A spec — отдельным approve запросить:

- §A code-patch (с kill-switch off);
- §F SBS-mismatch no-new-sub patch;
- §C / §B / §D / §E — каждый отдельным approve.
---

## 2026-05-14 — §A REBILL Materialization Spec выполнен

Артефакт: `.lovable/proofs/inv_rebill_materialization_spec_2026_05.md`.

Ключевые решения:
- Принятая модель: REBILL.id = единый source для финансов и для grant. Отказ от `do_not_grant_access`/`source_payment_uid` (point #1 — обоснован отсутствием контракта в `grant-access-for-order`).
- Pattern `order_number` оставлен текущим production-форматом `REBILL-<first8>-<next3>` (point #5).
- Resolver parent_subscription идёт по `provider_subscriptions` + `subscriptions_v2.meta`, без user+product fallback (point #6).
- Kill-switch расширен до `off|dry_run|on` (point #10).
- 23505 на REBILL uid → skip, не 500 (point #11).
- Атомарность INSERT REBILL+payment — будущим RPC `materialize_rebill_atomic` (миграция в §A code-patch, не сейчас).
- Refund: payment и refund webhook трактуются раздельно (point #8); существующий `record_refund_atomic` подходит без изменений (point #9).

Запреты §A: 0 DML, 0 миграций, 0 правок edge functions. Лариса не трогается.

Жду approve §A spec → дальше §F (SBS-mismatch no-new-sub) отдельным approve как блокер для production-включения.
