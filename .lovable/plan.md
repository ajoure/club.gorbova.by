## да, согласен, с учетом правок:

1. **План не завершён в сообщении.**  
Последний пункт обрывается на `БД не м...`. Перед запуском нужно прислать полный финальный текст плана, чтобы не потерять часть regression-test scope.
2. **В** `bepaid-webhook` **нельзя делать прямой** `INSERT orders_v2`**, если уже есть canonical materialization helper.**  
Требование: сначала найти существующий write-path для `REBILL-order` и использовать его. Если его нет — вынести создание в отдельный helper/service внутри функции, но не размазывать business logic по webhook. Архитектурно бизнес-логика должна быть в service layer, а flow должен оставаться `Payment → Order → Deal → Entitlement → Notification → Integrations`.  
3. **Idempotency key нужно унифицировать.**  
Сейчас указано два поля: `meta.materialized_from_payment_id` и `meta.source_payment_uid`. Нужно зафиксировать главный ключ:
  &nbsp;
  &nbsp;
  - `meta.source_payment_uid = bePaid transaction uid`;
  - `meta.materialized_from_payment_id` использовать только если это UUID локального `payments_v2.id`, а не bePaid uid.  
  Нельзя называть bePaid uid `payment_id`, иначе снова будет путаница provider ID vs local UUID.
4. `materialized_from_payment_id` **в п.1 сейчас противоречив.**  
В плане написано: `materialized_from_payment_id = <bepaid_uid>`. Это ошибка терминологии. Если поле называется `*_payment_id`, оно должно хранить локальный `payments_v2.id`. Для bePaid uid использовать:
  - `source_payment_uid`;
  - `provider_payment_id`;
  - `bepaid_uid`.
5. **Создание REBILL-order до записи payment может быть невозможно, если нужен local payment UUID.**  
Нужно явно определить порядок:
  - либо сначала создать/найти `payments_v2` по provider uid idempotently, затем создать order и привязать payment;
  - либо создать order с `source_payment_uid`, затем записать payment.  
  Главное — не допустить состояния, где order создан, а payment не записался без retry/idempotency.
6. `do_not_grant_access:false` **опасно для fully refunded сценариев.**  
Для autocharge сначала можно создавать `paid` order, но refund handler обязан после полного refund выставить состояние, при котором `grant-access-for-order` не продлит доступ. Добавить guard:
  - если `order.status='refunded'` или `paid_amount <= refunded_amount` или `meta.refunded_in_full=true` → no grant/no extend.
7. **Refund handler должен быть идемпотентным по refund uid.**  
Перед `record_refund_atomic` нужно проверить:
  - существует ли refund-row с `provider_payment_id=<refund_uid>`;
  - если да — не увеличивать `parent.refunded_amount` повторно;
  - audit/log `refund_duplicate_ignored`.
8. `parent.refunded_amount += refund.amount` **должен быть capped.**  
Добавить защиту:
  - `new_refunded_amount <= parent.amount`;
  - если больше — STOP/manual_review/audit, не делать over-refund в локальной модели.
9. `record_refund_atomic` **должен обновлять order-level refund state.**  
В плане указано обновление parent payment, но нужно явно добавить:
  - пересчет order refunded total;
  - `orders_v2.status='refunded'` при full refund;
  - `partial_refund`/аналогичный статус только если такой статус реально поддерживается enum/UI;
  - если нет поля `orders_v2.refunded_amount`, хранить агрегат в `meta` и UI считать через payments.
10. `grant-access-for-order` **не должен выставлять** `orders_v2.meta.manual_review=true` **прямым overwrite.**  
Только merge в `meta`, чтобы не затереть существующие ключи:

&nbsp;

- `meta.manual_review=true`;
- `meta.manual_review_reason='bepaid_subscription_mismatch'`;
- `meta.manual_review_at`;
- `meta.manual_review_context`.

11. **Mismatch audit должен включать найденных кандидатов.**  
Добавить в audit:

- `order_id`;
- `payment_id`;
- `payment_provider_uid`;
- `payment_bepaid_subscription_id`;
- `candidate_subscription_ids`;
- `candidate_bepaid_subscription_ids`;
- `product_id`;
- `tariff_id`.

12. **Duplicate guard должен проверять не только local active/trial/past_due.**  
Добавить:

- `provider_subscriptions.state IN ('active','past_due')`;
- локальные `provider_subscriptions` без `subscription_v2_id`;
- pending checkout/public link, если она уже может создать sbs;
- zombie-provider case: provider active + local expired → сначала manual decision/cancel старую, потом разрешать новую.

13. **Provider check через** `bepaid-get-subscription-details` **должен иметь fail-closed режим.**  
Если bePaid API недоступен или ответ ambiguous:

- не создавать новую подписку silently;
- вернуть `manual_review`;
- audit `subscription.duplicate_guard_provider_check_failed`.

14. **Тарифный переход нужно формализовать.**  
`tariff_change_detected:true` недостаточно. Нужно указать:

- кто может передать `confirm_tariff_change=true`;
- где это подтверждается в UI;
- что происходит со старой sbs;
- отменяется ли старая provider subscription;
- не будет ли двойного списания.

15. `DealDetailSheet` **не должен определять refund только через** `meta.parent_payment_id`**.**  
Для backward compatibility добавить fallback:

- `meta.parent_payment_uid`;
- `parent_payment_id` если есть отдельная колонка;
- matching by provider parent uid, если присутствует в meta.  
Но основной новый стандарт — `meta.parent_payment_id`.

16. **Header date helper нужно проверить на все места использования.**  
Если `getEffectiveDealDate.ts` используется в списках, фильтрах, статистике или периодах, изменение не должно ломать month grouping. Нужно явно указать: правим только display header или весь helper с regression proof по списку сделок.
17. **Deno-тесты не должны требовать реального bePaid.**  
Добавить mock/stub для:

- bePaid subscription details;
- cancel/details calls;
- webhook payloads;
- Supabase client calls, если текущая тестовая инфраструктура это поддерживает.  
Никаких реальных credentials в тестах.

18. **Добавить тест по кейсу Ларисы как fixture.**  
Минимальный fixture:

- initial order март;
- old sbs;
- new sbs;
- autocharge old sbs;
- refund old sbs;
- verify: old initial order не меняется, new subscription не продлевается чужим sbs.

19. **Добавить anti-data-change proof.**  
Так как этап заявлен “только код + тесты”, отчет должен содержать:

- список измененных файлов;
- подтверждение, что миграций нет или если есть RPC — отдельно объяснить;
- подтверждение, что DML по production таблицам не выполнялся;
- тестовые данные не писались в production.

20. **Если добавляется RPC** `record_refund_atomic`**, это уже не “только код” в узком смысле.**  
Если RPC уже существует — указать “используем существующий RPC, без миграций”.  
Если RPC нужно создать/изменить — это SQL migration, и план должен явно включить:

- migration file;
- security definer/RLS rationale;
- idempotency;
- tests;
- no production DML.

21. **Audit system actor proof обязателен для новых веток.**  
В отчете после тестов/локального proof показать, что audit payload формируется с:

- `actor_type='system'`;
- `actor_user_id=NULL`;
- `actor_label`;
- action name;
- entity IDs.

22. **Этап 4 sweep не запускать в рамках этого плана.**  
После code-fixes можно сделать только read-only query/report. Любые repair по найденным кандидатам — отдельный план и отдельный approve.
23. **Финальный DoD добавить явно:**

- `bepaid-webhook` autocharge test passed;
- refund test passed;
- missing parent test passed;
- `grant-access-for-order` mismatch test passed;
- duplicate guard tests passed;
- `DealDetailSheet` date/refund rendering proof;
- diff-summary;
- no production data changes;
- файл proof обновлен.

После внесения этих правок план можно запускать как **code-fix этап без data-repair**.

&nbsp;

План: Этап 3 — root code-fixes (DEAL-LINKAGE)

Repair Ларисы закрыт. Этап 3 устраняет первопричины расхождения, выявленные в Этапе 1. **Никаких UPDATE/INSERT в payments_v2 / orders_v2 / subscriptions_v2 / entitlements / access_rules / telegram_*** — только код + тесты.

---

### 1. `bepaid-webhook` — autocharge → отдельный REBILL-order

**Где:** `supabase/functions/bepaid-webhook/index.ts` (6819 строк, ветка обработки `transaction.notification` где `parent_uid != null` и матч по `bepaid_subscription_id`).

**Дефект Ларисы:** платёж 13.05 (`e2eedd12…`) был приклеен к мартовскому initial-order `11adac7b…` вместо нового REBILL.

**Изменения:**

- Перед записью `payments_v2` для autocharge:
  1. Идемпотентность: `SELECT id FROM orders_v2 WHERE meta->>'materialized_from_payment_id' = <bepaid_uid> OR meta->>'source_payment_uid' = <bepaid_uid>` — если есть, переиспользовать.
  2. Иначе INSERT нового `orders_v2` со схемой как в апрельском REBILL Ларисы (см. `06b224ab…`): `order_number = REBILL-<first8>-<next3>`, `status='paid'`, `paid_amount=<amount>`, `deal_date=<paid_at>`, `bepaid_subscription_id=<sbs>`, `meta` с `materialization_run='bepaid_webhook_rebill'`, `materialized_from_payment_id`, `source_payment_uid`, `parent_order_id` (= initial order той же sbs), `payment_flow='bepaid_subscription_charge'`, `do_not_grant_access:false` (доступ выдаёт grant-access-for-order через extend).
  3. Pipeline_id/stage_id наследовать из initial-order.
- Платёж пишется с `order_id = <new_rebill_id>`. Initial-order не апдейтится.
- Audit `bepaid.webhook.rebill_order_created` (system actor) с `before:null`, `after:{order_id, payment_id, sbs}`.

**Risk:** регрессия на legitimate первичные платежи. Mitigation: новая ветка работает только если `parent_uid != null` (т.е. это явный rebill-нотификейшн bePaid), и только когда нашли `subscriptions_v2.bepaid_subscription_id = <sbs>`.

---

### 2. `bepaid-webhook` — refund: parent linkage + atomic update

**Дефект Ларисы:** refund-row `49825c85…` — `meta.parent_payment_id=NULL`, `parent.refunded_amount=0`, `order_id` указывал на чужой initial-order.

**Изменения (та же функция, ветка refund-нотификейшна):**

- Резолвить parent: `SELECT id, order_id, refunded_amount FROM payments_v2 WHERE provider_payment_id = <refund.parent_uid> LIMIT 1`. STOP-guard если 0 строк → audit `bepaid.webhook.refund_parent_not_found` + 200 fallback (по правилу Payment Error Handling).
- Через RPC `record_refund_atomic` (см. memory `Partial Refund State`): refund-row записывается с `order_id = parent.order_id` (а не initial-order), `meta.parent_payment_id`, `meta.parent_payment_uid`, `transaction_type='Возврат средств'`, **знак amount не меняется** (хранится как положительный, как было у Ларисы и как требует системный стандарт).
- `parent.refunded_amount += refund.amount`, `refunded_at = max(existing, refund.paid_at)`.
- Audit `bepaid.webhook.refund_recorded` system actor.

---

### 3. `grant-access-for-order` — extend только при матче `bepaid_subscription_id`

**Где:** `supabase/functions/grant-access-for-order/index.ts` (1930 строк, секция «попытка extend существующей подписки»).

**Дефект Ларисы:** платёж старой sbs `sbs_d0a38a4774c31891` продлил **новую** sub `b749abfb` (sbs `sbs_e58bb848165cb713`), потому что extend искался только по `product_id + tariff_id`.

**Изменения:**

- Резолв активной recurring-sub: фильтр `WHERE bepaid_subscription_id = <order.bepaid_subscription_id>` (если у order есть sbs).
- Если у платежа есть sbs, но в `subscriptions_v2` нет совпадения по sbs:
  - НЕ создавать новую цепочку автоматически;
  - audit `grant.skip_extend_bepaid_subscription_mismatch` (system actor) с `{order_id, payment_id, payment_sbs, candidate_sub_id, candidate_sub_sbs}`;
  - выставить `meta.manual_review=true` на orders_v2 для этого ордера;
  - вернуть `success:true, extended:false, manual_review:true` (без исключений, без падения webhook).
- Контракт `Extend ↔ Tariff Match` (memory) сохраняется: tariff_id-проверка остаётся, **bepaid sbs match добавляется как первичный фильтр для recurring**.

---

### 4. Duplicate Subscription Prevention Guard

**Где:** `supabase/functions/_shared/duplicateSubGuard.ts` (если есть) или inline в `create-payment-checkout` / `admin-create-public-link`. Проверю структуру в impl-фазе.

**Дефект Ларисы:** 12.05 создалась новая bePaid sbs при живой старой sbs того же продукта.

**Изменения:**

- Расширить guard:
  1. local check: `subscriptions_v2 WHERE user_id=? AND product_id=? AND status IN ('active','past_due','trial')`;
  2. provider check: для каждой найденной local-sub с непустым `bepaid_subscription_id` зовём `bepaid-get-subscription-details` → если provider state ∈ {active, past_due} — это дубль;
  3. учитываем `(product_id, tariff_id, provider)`;
  4. при разном `tariff_id` того же product — НЕ блокировать; возвращать `tariff_change_detected:true` и требовать `confirm_tariff_change=true` от вызывающего (UI/admin) — без manual decision не блокировать legitimate UX, но и не пропускать silently.
- audit `subscription.duplicate_guard_blocked` / `subscription.tariff_change_requires_confirmation`.

---

### 5. `DealDetailSheet` — header/month from `orders_v2.deal_date`

**Где:** `src/components/admin/DealDetailSheet.tsx`, `src/utils/getEffectiveDealDate.ts`.

**Дефект Ларисы:** заголовок «13 мая 05:00» при «Месяц: Март 2026» — потому что header брался из `max(payment.paid_at)`.

**Изменения:**

- Заголовок и месяц-чип читать строго из `order.deal_date` (fallback `created_at` при NULL); удалить fallback на `max(payment.paid_at)`.
- Платежи рендерить с вложенными refund-строками: для каждого `payment` где `transaction_type !== 'Возврат средств'` — показать payment + nested refunds (filter по `meta.parent_payment_id === payment.id`); под платежом строка «Net = amount − Σrefunds».
- Логика badge оставить через memory `Partial Refund State` (paidSum / refundedSum).
- Скоуп — только presentation, бизнес-данные не трогаются.

---

### 6. Регресс-тесты (Deno)

`supabase/functions/bepaid-webhook/webhook_rebill_test.ts`:

- autocharge с `parent_uid` + sbs → создаётся новый `orders_v2` с `meta.materialized_from_payment_id`; initial-order не меняется; повторный webhook с тем же uid — идемпотентно (0 новых rows).
- refund nofification → `parent.refunded_amount += amount`, refund-row пишется с `order_id=parent.order_id`, `meta.parent_payment_id` присутствует, знак amount положительный.
- refund для несуществующего parent_uid → 200 + audit `refund_parent_not_found`, БД не меняется.

`supabase/functions/grant-access-for-order/grant_sbs_match_test.ts`:

- order.sbs = X, sub.sbs = Y, тот же product/tariff → no extend, audit `skip_extend_bepaid_subscription_mismatch`, `manual_review=true`.
- order.sbs = X, sub.sbs = X → extend выполняется как раньше.

UI-тест `DealDetailSheet.test.tsx` (vitest):

- Order с `deal_date='2026-03-13'` и payment `paid_at='2026-05-13'` → заголовок «13 марта 2026», chip «Март 2026» (не май).
- Order с payment + refund (matched через `meta.parent_payment_id`) → refund вложен под платежом, показан Net.

---

### Порядок execute Этапа 3

1. Diagnose: прочитать `bepaid-webhook` (autocharge + refund ветки), `grant-access-for-order` (extend секция), `DealDetailSheet`, существующий `_shared/duplicateSubGuard*`.
2. Применить изменения файл-за-файлом, сохраняя CORS / `Deno.serve` / `npm:@supabase/supabase-js@2`.
3. Написать тесты, прогнать `supabase--test_edge_functions`.
4. Деплой `bepaid-webhook`, `grant-access-for-order`, при необходимости `create-payment-checkout`/`admin-create-public-link`.
5. Smoke (read-only): прогнать тестовый payload через `supabase--curl_edge_functions` на статической фикстуре, без записи в реальные таблицы (тесты используют моки supabase-client / транзакционный rollback).
6. Memory-апдейты:
  - `mem://architecture/subscriptions/bepaid-webhook-rebill-order-standard` — каждый autocharge = свой REBILL-order;
  - `mem://commercial-logic/access/extend-tariff-match-required` — добавить пункт «sbs_id match обязателен для recurring extend»;
  - `mem://ui/admin/deal-detail-sheet-header-canon` — header строго из `deal_date`.

### Запреты (повторно)

- никаких UPDATE/INSERT в payments_v2 / orders_v2 / subscriptions_v2 / entitlements / access_rules / telegram_* через `supabase--insert` или migrations с DML;
- Лариса (`e748983f…`, заказы `11adac7b…`, `09058c05…`) не трогается;
- никаких новых cron/триггеров без отдельного approve.

### DoD Этапа 3

- 4 edge-функции/UI обновлены, 6 тестов зелёные;
- proof-файл `.lovable/proofs/inv_deal_linkage_root_fixes_2026_05.md` с diff-summary, выводом тестов, deploy-логом;
- 3 memory-обновления;
- git diff чист от данных-миграций.