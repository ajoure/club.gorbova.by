# да, согласен, с учетом правок:

1. **Формат отчёта исправить заранее**

В deliverables сейчас указано:

```text
Отчет о выполнении: Phase B discovery
```

Нужно строго:

```text
Отчет о выполненной работе: PATCH-PREORDER-DEAL-FLOW Phase B — discovery
```

2. **Discovery-only scope подтверждён**

Правильно:

- без миграций;
- без edge-функций;
- без фронта;
- без HTML;
- без правок `grant-access-for-order`;
- только SQL/code-read/consumer audit + execute-план.

Этот scope не расширять.

3. **Вариант C сразу считать запрещённым**

В плане можно сразу зафиксировать:

```text
C — перенос pay_now order в preorder deal-карточку — запрещён.
orders_v2 остаётся SOT по сделкам/заказам. paid order не должен перезаписываться в draft preorder и наоборот.
```

Discovery должен выбирать только между:

- **A:** preorder остаётся `draft`, переводится в success-stage + `meta.converted_to_order_id`;
- **B:** preorder остаётся/становится canceled/superseded + `meta.superseded_by_order_id`.

4. **С высокой вероятностью безопаснее B, но пусть discovery докажет**

Предварительно предпочтительный вариант:

```text
B: PREORDER-* помечается superseded/canceled и скрывается из активного Kanban, paid order остаётся единственной revenue/won-сделкой.
```

Причина: если draft-preorder перевести в success-stage, в CRM может появиться визуальная «успешная сделка» без выручки рядом с paid order. Это риск для отчётов/канбана.

Но финальное решение — после проверки consumers `orders_v2`.

5. **Q5 усилить: проверять не только revenue, но и CRM counts**

В consumer audit добавить:

- какие фильтры строят суммы;
- какие фильтры строят count сделок по стадиям;
- какие фильтры строят «успешные сделки»;
- какие фильтры строят funnel conversion;
- показывает ли `/admin/crm/deals` `status='draft'` в success stage.

Если CRM считает success-stage независимо от `status/meta.is_revenue`, вариант A опасен.

6. **Матчинг клиента: добавить приоритеты**

В discovery по Q1 зафиксировать candidate policy:

```text
1. user_id exact match, если оба order имеют user_id
2. normalized email exact match
3. phone только как secondary signal, не единственный ключ
4. окно: preorder created_at <= paid_order.created_at и не старше N дней
```

Не матчить только по телефону.

7. **Матчинг продукта: product_id — основной ключ**

Для Phase B предпочтительно:

```text
same product_id
```

а не `same tariff_id`, потому что preorder T-000074 может конвертироваться в разные pay_now офферы того же продукта:

- корпоративная карта;
- по счёту;
- будущий pay_now.

Но discovery должен проверить, нет ли риска конвертировать preorder одного направления в покупку другого продукта.

8. **Trial → pay_now оставить out of scope**

Уточнить:

```text
trial offer 891c7fe0… не должен сам конвертировать preorder в Phase B, если не является paid order.
```

Phase B — только paid/pay_now order после фактической оплаты.

9. **Точка вызова: не внутри grant write-path без необходимости**

Для Q3 добавить критерий выбора:

- если можно безопасно вызвать convert **после** успешного `grant-access-for-order` в webhook wrapper — предпочтительно;
- не добавлять write-логику внутрь core grant, если можно оставить grant canonical path untouched;
- convert-шаг должен быть best-effort/idempotent: ошибка конверсии не должна откатывать paid/grant.

10. **Convert-step не должен быть hard blocker оплаты**

В execute-плане потом обязательно:

```text
Если preorder-convert failed, paid order и grant остаются успешными. Ошибка конверсии пишется в audit/domain_executions/manual_review, но не ломает оплату.
```

Discovery должен проверить, где можно это вставить.

11. **Audit: предпочтительно domain_executions + audit_logs**

Не выбирать только одно до discovery.

Проверить, что уже используется для webhook/lifecycle:

- `domain_executions`;
- `audit_logs`;
- `provider_events`;
- `payment_reconcile_queue`.

В execute-плане предложить SOT-аудит по существующему стилю проекта.

12. **SQL-аудит существующих PREORDER надо расширить**

Добавить запросы:

- сколько `orders_v2` с `meta.is_preorder=true`;
- сколько имеют `meta.converted_to_order_id` / `superseded_by_order_id`;
- сколько имеют тот же email + product_id и уже paid order после preorder;
- сколько имеют pipeline success stage при `status='draft'`;
- сколько потенциальных дублей по email/product за 24 часа/90 дней.

13. **Fulfillment Collision Safety — отдельно проверить**

В Q7 добавить:

```text
convert-on-pay не должен писать в access_grant_ledger, entitlements, telegram_access_queue и не должен вызывать grant-access-for-order повторно для preorder order_id.
```

Иначе можно попасть в hard 500 по order_id mismatch.

14. **Broadcast purchased-filter / analytics — обязательный grep**

Поскольку уже был риск с `orders_v2 status='paid'`, в discovery обязательно grep:

```text
orders_v2
status.eq.paid
status='paid'
final_price
paid_amount
is_revenue
is_preorder
```

по:

```text
src/
supabase/functions/
supabase/migrations/views
```

15. **Execute-план должен быть только после answers Q1–Q8**

Не формировать implementation заранее. В конце discovery допустимо дать 1 рекомендованный вариант, но с evidence.

Формат финального блока:

```text
Рекомендованный вариант Phase B: A/B
Причина:
Риски:
Execute-план:
STOP-guards:
DoD:
```

## **Итог**

План можно выполнять как **read-only discovery**. Правки не делать до отдельного approve execute-плана.

&nbsp;

План: PATCH-PREORDER-DEAL-FLOW Phase B — convert-on-pay discovery

## Цель

Зафиксировать безопасный механизм «конверсии» preorder-deal (draft `PREORDER-*`) в реальный `paid` order при последующей оплате того же продукта тем же клиентом, **без**:

- двойного выставления стадии воронки,
- двойного начисления выручки в отчётах,
- двойного `grant-access-for-order`,
- модификации канонического write-path `grant-access-for-order`.

Phase B — **read-only discovery**. Никаких миграций, edge-функций, фронта, HTML-патчей. Только запросы к БД, чтение кода, сводный отчёт + execute-план на согласование.

## Скоуп discovery

Продукт-носитель — Gorbova Club «Идеология» (`product_id=3ea08f79…`). На нём сосуществуют:

- preregistration T-000074 (`offer_id=7b939741…`, amount=0) — источник draft-сделок Phase A;
- trial (`offer_id=891c7fe0…`, amount=0);
- pay_now «КОРПОРАТИВНОЙ КАРТОЙ» (`339b6d25…`, 350) и «ПО СЧЁТУ» (`6a0fbe9e…`, 375).

Все четыре оффера ведут в один pipeline `a0000001…` со стадиями pending/success/failed. Это создаёт риск: при оплате pay_now появляется второй deal в той же воронке, рядом с висящим `PREORDER-*` draft.

## Что выяснить (вопросы discovery)

### Q1. Идентичность «того же клиента»

По какому ключу матчим preorder-deal с будущим pay_now order:

- `orders_v2.customer_email` (нормализованный `lower(btrim)`),
- `orders_v2.user_id` (если был залогинен),
- `orders_v2.customer_phone` (нормализованный),
- комбинация + временное окно (например, 90 дней).
Что делать, если совпадает email, но другой user_id (гость → авторизованный).

### Q2. Идентичность продукта/тарифа

- Конверсия по `product_id` достаточна, или нужно совпадение `tariff_id`?
- Корпоративный pay_now (350) и pay_now по счёту (375) — оба конвертируют один preorder, или только определённый тариф (например, прописанный в `meta.intended_tariff_id` preorder-deal)?
- Что с trial → pay_now (отдельный кейс, не Phase B).

### Q3. Кто триггерит конверсию

Кандидаты, отсортированные по риску (от низкого к высокому):

1. Доп. шаг внутри `grant-access-for-order` после успешного grant — read-only пометка `PREORDER-*` как `superseded_by=<paid_order_id>` без вмешательства в сам grant. **Не** менять статус, не дублировать grant.
2. Отдельная edge `preorder-convert-on-pay`, вызываемая webhook’ом bePaid **после** того, как `grant-access-for-order` отработал и аудит зафиксирован.
3. Nightly reconcile job, чисто административный (без realtime UX).

Discovery должно решить: где это безопаснее, с учётом существующей идемпотентности `grant-access-for-order` и Fulfillment Collision Safety (hard 500 на order_id mismatch).

### Q4. Что значит «конвертировать» технически

Перечислить варианты и зафиксировать выбранный:

- (A) Перевод `PREORDER-*` deal в стадию `stage_on_success` и пометка `meta.converted_to=<paid_order_id>`, при этом сам draft остаётся в `orders_v2` со `status='draft'`, `is_revenue=false`. Реальный pay_now order живёт отдельно как SOT выручки.
- (B) `status='canceled'` на `PREORDER-*` + `meta.superseded_by=<paid_order_id>` (не перетекает в Won).
- (C) Перенос pay_now order в ту же deal-карточку (нет, ломает SOT — orders_v2 = SOT по сделке).
Discovery должно явно отвергнуть (C) и выбрать между (A) и (B) с обоснованием для Kanban-UX.

### Q5. Анти-revenue инварианты

Подтвердить SQL-запросом, что текущие отчёты выручки/CRM/аналитики фильтруют `meta->>'is_revenue' = 'false'` ИЛИ `status='draft'`. Список консьюмеров `orders_v2`:

- `/admin/crm/deals` (kanban),
- отчёты по выручке (revenue dashboards),
- broadcast purchased-фильтр (по memory: «не rule_engine»),
- analytics views.
Если хоть один консьюмер не фильтрует — Phase B не может пометить draft как «success», обязан использовать вариант (B).

### Q6. Идемпотентность и порядок событий

- Что если webhook bePaid придёт повторно? `grant-access-for-order` уже идемпотентен — convert-шаг должен быть такой же: повторный вызов не должен «расконвертировать» или дублировать пометку.
- Что если pay_now пришёл **раньше**, чем preorder (странный race)? Конверсия должна стать no-op.
- Что если есть несколько `PREORDER-*` deals на один email (рекомендация по дедупликации)?

### Q7. Не сломать `grant-access-for-order`

Подтвердить read-only:

- никаких новых веток внутри grant write-path,
- никаких изменений в `subscriptions_v2`/`entitlements`/`access_rules`,
- никаких новых `telegram_access_queue` записей (по memory: автогрант идёт только через canonical path).

### Q8. Audit

- Где writeAudit для конверсии: новый `domain_executions` тип `preorder.converted` ИЛИ `audit_logs`.
- Какой actor: system (webhook-trigger) vs JWT (если вызов из админки).

## Что сделать в Phase B discovery (read-only)

1. **Снимок consumers `orders_v2**`: grep по `src/` + `supabase/functions/` на использование `status`, `final_price`, `paid_amount`, `is_revenue`, `is_preorder`. Зафиксировать, какие фильтруют draft/preorder, какие — нет.
2. **Снимок текущего `grant-access-for-order**`: какие meta-поля он читает, чтобы понять, можно ли «прицепиться» к нему без модификации.
3. **SQL-аудит существующих `PREORDER-*` записей**: сколько уже создано, есть ли среди них email-совпадения с уже оплаченными `pay_now` orders (это пилотные данные для Phase B convert-логики).
4. **Проверка bePaid webhook flow** (`bepaid-webhook`): порядок шагов, момент после которого grant гарантированно завершён, точка возможной вставки convert-вызова без race с `grant-access-for-order`.
5. **Проверка Kanban UI**: как отрендерится pair (draft `PREORDER-*` + paid pay_now) в одной воронке. Нужен ли визуальный «merge» или достаточно `meta.superseded_by` со скрытием superseded draft.
6. **Подготовка execute-плана Phase B** на основе ответов Q1–Q8, со списком файлов/функций/миграций — **на отдельное согласование**, не выполнять.

## Out of scope Phase B discovery

- Любые изменения схемы.
- Любые изменения `grant-access-for-order`, `bepaid-webhook`, `subscriptions_v2`.
- Изменения фронта/HTML SITE-000018.
- Конверсия trial → pay_now (отдельный трек).
- Массовый бэкфилл уже существующих `PREORDER-*` сделок.

## Deliverables Phase B discovery

1. Сводный отчёт «Отчет о выполнении: Phase B discovery» с ответами на Q1–Q8 + ссылками на код/SQL-evidence.
2. SOT-фиксация выбранного варианта конверсии (A или B) с обоснованием.
3. Execute-план Phase B — отдельным сообщением, формат «План: …», **не выполнять до approve**.

## DoD discovery

- Все Q1–Q8 закрыты с evidence.
- Подтверждено, что выбранный вариант конверсии не нарушает: Canonical Write Path, Fulfillment Collision Safety, Auto-Renewals Cohort SOT, Commercial Entity SOT, Synthetic Order Analytics, Default Pipeline Scope.
- Согласован execute-план Phase B перед началом любых правок.