# да, согласен, с учетом правок:

1. **Не начинать с revoke. Сначала только Discovery.**

Этот план слишком рискованный для немедленной реализации, потому что автоматический отзыв Telegram-доступа — критичная зона.

Разделить на два этапа:

```text
Phase 3.5-A — Discovery only
Phase 3.5-B — implementation after approve
```

Сейчас разрешён только **Phase 3.5-A Discovery**.

---

2. **Не реализовывать автоматический revoke в этом шаге**

В текущем спринте запретить:

- закрывать entitlement;
- вызывать `telegram-revoke-access`;
- менять `telegram_access`;
- менять `access_rules`;
- добавлять новые revoke-ветки.

До отдельного approve после discovery.

---

3. **Ответ на вопрос 1**

Триггер финального revoke:

```text
пока не утверждаем
```

Нужно сначала discovery по текущим writers/reconcile/revoke-функциям.

Предварительная позиция:

- webhook может только маркировать final_failure;
- фактический revoke лучше делать через существующий reconcile/safety net;
- но окончательно — после discovery.

---

4. **Ответ на вопрос 2**

Да, cross-provider guard обязателен:

```text
если bePaid или другая активная подписка даёт доступ к тому же продукту/клубу,
Stripe revoke не должен снимать Telegram-доступ.
```

Это должно быть отдельным обязательным guard в будущей реализации.

---

5. **Ответ на вопрос 3**

Окно grace:

```text
используем Stripe Smart Retries как SOT
```

Не вводить свой hard cutoff 14 дней в этом этапе.

Любой hard cutoff — отдельный future PATCH.

---

6. **Ответ на вопрос 4**

Для тестов:

```text
основной путь — реальные Stripe test-mode события через Hosted Checkout / Portal / Dashboard
```

`stripe trigger` использовать только как fallback для replay/idempotency, не как основной proof бизнес-сценария.

---

7. **Добавить обязательный safety блок**

В Discovery требовать отдельную матрицу:

```text
Кто имеет право отзывать доступ:
- subscriptions-reconcile
- telegram-check-expired
- telegram-revoke-access
- manual admin action
- webhook
```

И для каждого:

- когда вызывается;
- какие guards;
- учитывает ли другие активные entitlements;
- учитывает ли bePaid;
- можно ли безопасно использовать для Stripe.

---

8. **Изменить финальный результат Phase 3.5-A**

DoD Discovery должен быть:

```text
1. Полная карта текущего revoke/access pipeline.
2. Матрица рисков.
3. Предложение безопасной реализации Phase 3.5-B.
4. Runtime test plan G41–G48.
5. Отдельный approve перед любыми изменениями доступа.
```

---

Итог: **Phase 3.5-A Discovery можно запускать. Phase 3.5-B Implementation пока нельзя запускать.**

&nbsp;

План: Phase 3.5 — Stripe Access Lifecycle (Suspend / Revoke / Restore)

## Контекст

Платёжный контур Stripe подтверждён runtime-проверкой (Checkout, Subscription Checkout, Portal, rebill, grant-access — PASS). Phase 3.4 (Dunning) технически открыта, но базовая работоспособность доказана. Переходим к следующему незакрытому блоку — автоматическому управлению доступом на стыке Stripe lifecycle ↔ entitlements ↔ Telegram.

## Цель

Полностью автоматический жизненный цикл доступа:

- `active` → доступ есть
- `past_due` → доступ сохраняется (grace)
- recovery (`invoice.paid` после failure) → доступ остаётся
- `unpaid` / `canceled_after_dunning` → доступ автоматически отзывается (entitlement + Telegram)
- новая успешная оплата → доступ возвращается через канонический `grant-access-for-order`

## Жёсткие правила (немутабельные)

- bePaid не трогаем (никаких изменений в `bepaid-webhook`, `subscription-charge`, `direct-charge`, `payment-methods-webhook`).
- `grant-access-for-order` не модифицируется — используется как есть (canonical write-path).
- Никакой отдельной access-логики «только для Stripe» — переиспользуем `entitlements`, `access_rules`, `access_grant_ledger`, `telegram-revoke-access`, `telegram-grant-access`, `subscriptions-reconcile`.
- SOT: `subscriptions_v2` (статус подписки) + `entitlements` (фактический доступ).
- Никаких ручных `UPDATE entitlements` / `UPDATE telegram_access` в новом коде. Все мутации — через существующие edge functions / RPC.
- Add-only по `meta.stripe.dunning_status` (уже зарезервировано в Phase 3.4 discovery) и audit-actions.
- Webhook moratorium соблюдается: правки только в `_shared/stripe-subscription-resolver.ts` и (по необходимости) в `subscriptions-reconcile`; сам endpoint `stripe-webhook` не переразворачиваем без причины.

## Этап A. Discovery (read-only)

Зафиксировать текущее поведение по 4 статусам и составить карту участников:

1. Прочитать и описать:
  - `supabase/functions/_shared/stripe-subscription-resolver.ts` (handlers `onSubscriptionUpdated`, `onSubscriptionDeleted`, `onInvoicePaymentFailed`, `onInvoicePaid`)
  - `supabase/functions/subscriptions-reconcile/`
  - `supabase/functions/telegram-revoke-access/` (контракт вызова, args, idempotency)
  - `supabase/functions/telegram-grant-access/`
  - `entitlements` lifecycle (как закрывается: `status='expired'` vs `expires_at`)
  - `access_rules` для `grant_target_type='club'` (Telegram)
  - Существующие cron: `telegram-check-expired`, `access-rules-nightly-reconcile`, `subscription-grace-reminders`
2. Ответить письменно для каждого Stripe-статуса (`active`/`past_due`/`unpaid`/`canceled`):
  - что меняется в `subscriptions_v2`
  - что происходит с `entitlements`
  - что происходит с `telegram_access`
  - какой audit пишется
3. Найти gap'ы между «как должно быть по цели» и «как сейчас».

Артефакт: `.lovable/discovery/stripe_access_lifecycle_inventory_v1.md`.

## Этап B. Grace Period (past_due)

Подтвердить и явно задокументировать инвариант: `past_due` НЕ отзывает доступ.

Изменения:

- В `onInvoicePaymentFailed`: при первом переходе `active → past_due` писать `meta.stripe.dunning_status='past_due_grace'`, `grace_started_at=now()` (add-only в `subv2.meta.stripe`).
- Audit: `stripe.access.grace_started` (один раз per `invoice_id`, idempotent через проверку существующего marker).
- В `onInvoicePaid` (recovery branch): при наличии `dunning_status='past_due_grace'` → `dunning_status='recovered'`, `grace_finished_at=now()`, audit `stripe.access.grace_finished` + `stripe.dunning.recovered`.
- Никаких revoke-вызовов в grace.

## Этап C. Final Revoke

Триггер: `customer.subscription.updated` со статусом `unpaid` ИЛИ `customer.subscription.deleted` с предыдущим `dunning_status ∈ {past_due_grace, ...}`.

Действия (все через канонические writers, idempotent):

1. `subscriptions_v2.status` → `canceled` (для `unpaid` после Smart Retries — также `canceled` с `cancel_reason='stripe_dunning_final_failure'`).
2. Закрыть связанный `entitlement`: вызов существующего пути закрытия (через `subscriptions-reconcile` ветку «провайдер dead» или существующий RPC; точный путь определяется в Discovery A — НЕ создаём новый прямой UPDATE).
3. Telegram: вызов `telegram-revoke-access` с явным `club_id` (по `telegram-revoke-safety` memory) для всех `access_rules` подписки.
4. Audit: `stripe.access.revoked`, `stripe.access.revoked.entitlement`, `stripe.access.revoked.telegram`, с `revoke_reason ∈ {unpaid_after_dunning, canceled_after_dunning}`.
5. `meta.stripe.dunning_status='final_failure'` или `'canceled_after_dunning'` + `revoked_at`.

Guards:

- Idempotency по `subscription_id` + `dunning_status` (не отзываем дважды).
- Если у пользователя есть другая активная подписка на тот же `product_id` / `club_id` — Telegram revoke пропускаем (audit `stripe.access.revoked.telegram_skipped_other_active`).
- Cross-provider safety: если access выдан bePaid-подпиской — Stripe revoke не трогает её (проверка по `entitlement.source_subscription_id`).

## Этап D. Restore

Никакой новой логики — переиспользуем существующий путь:

- `invoice.paid` (recovery после revoke) → `orders_v2` (paid) → `grant-access-for-order` → entitlement (re)open + Telegram grant через `telegram-grant-access` (стандартный auto-grant single path).
- Новая подписка после revoke → стандартный Subscription Checkout flow.

Добавляем только audit-маркер:

- `stripe.access.restored` пишется в `onInvoicePaid`, если предыдущий `dunning_status ∈ {final_failure, canceled_after_dunning}` и текущий вызов привёл к успешному grant.

## Этап E. Runtime Proof (G41–G48)

Test-mode сценарии в Stripe (без правок кода после фиксации фаз B/C/D):


| Gate | Сценарий                                         | Ожидание                                                    |
| ---- | ------------------------------------------------ | ----------------------------------------------------------- |
| G41  | Активная подписка                                | `entitlement active`, Telegram `member`                     |
| G42  | `invoice.payment_failed` (1×)                    | `subv2.status=past_due`, доступ есть, audit `grace_started` |
| G43  | `invoice.payment_failed` (повторно)              | доступ есть, отдельный audit `retry_failed`                 |
| G44  | `subscription.status=unpaid` после Smart Retries | `subv2.canceled`, entitlement закрыт, audit `revoked`       |
| G45  | После G44                                        | `telegram_access` не `member`, audit `revoked.telegram`     |
| G46  | Новый успешный `invoice.paid` после revoke       | entitlement восстановлен, audit `restored`                  |
| G47  | После G46                                        | Telegram `member` восстановлен                              |
| G48  | bePaid за весь Phase 3.5                         | 0 регрессий: счётчик rebill / webhook errors не изменился   |


Доказательства: `provider_events`, `audit_logs`, `subscriptions_v2`, `entitlements`, `telegram_access` snapshots до/после, edge function logs.

Артефакт: `.lovable/proofs/stripe_phase_3_5_runtime_proof_v1.md`.

## Definition of Done

- `past_due` подтверждённо не отзывает доступ (G42, G43 PASS).
- `unpaid` / `canceled_after_dunning` автоматически отзывает entitlement + Telegram (G44, G45 PASS).
- Recovery через канонический `grant-access-for-order` восстанавливает доступ (G46, G47 PASS).
- bePaid pipeline без регрессий (G48 PASS).
- `grant-access-for-order` не модифицирован (diff = 0).
- Все мутации доступа идут через существующие writers (grep подтверждает отсутствие новых прямых `UPDATE entitlements` / `UPDATE telegram_access` в новом коде).
- Discovery + Runtime Proof артефакты созданы.

## Вопросы оператору перед стартом (Этап A)

1. **Триггер финального revoke**: ориентируемся ТОЛЬКО на webhook `customer.subscription.{updated:unpaid, deleted}` или подключаем также `subscriptions-reconcile` как safety net (для случаев пропущенных webhook)?
2. **Cross-provider conflict**: если у пользователя одновременно активна Stripe-подписка (которая уходит в `unpaid`) И bePaid-подписка на тот же продукт — подтверждаем, что bePaid сохраняет Telegram-доступ, Stripe-revoke его не трогает?
3. **Окно grace**: оставляем grace по Stripe Smart Retries (Stripe сам решает когда `unpaid`), или хотим явный max-grace в днях с нашей стороны (например, hard cutoff через 14 дней даже если Stripe ещё retry'ит)?
4. **Test-mode payment_failed**: для G42–G44 используем Stripe test cards (`4000 0000 0000 0341` — fail на attach, и т.д.) на реальной test-mode подписке, или строим сценарии через CLI `stripe trigger`?
---

# Отчет о выполнении: Phase 3.5-A Discovery

Артефакт: `.lovable/discovery/stripe_access_lifecycle_inventory_v1.md`.

Ключевые выводы:
- Сегодня **ни одна Stripe-ветка резолвера не отзывает доступ** (ни entitlement, ни Telegram). Phase 3.4 пишет только маркеры (`past_due_grace`, `recovered`, `final_failure`, `canceled_after_dunning`) в `subscriptions_v2.meta.stripe.*`.
- Канонический revoke-primitive `executeRevoke` (`_shared/access-revoker.ts`) уже встроен в 10 writers (`subscriptions-reconcile`, `telegram-check-expired`, `telegram-revoke-access`, `subscription-admin-actions`, и др.), сразу учитывает cross-provider (`hasCommercialAccess`) и пишет skip-ledger.
- Безопасная реализация 3.5-B возможна **без новых writers**: достаточно в webhook H-ветке выставлять `subscriptions_v2.cancel_at = now()` при переходе `past_due_grace → unpaid/canceled` — далее cron `subscriptions-reconcile` сам отрабатывает через канонический путь.
- Self-cancel через Portal (`cancel_at_period_end`) НЕ задевается — естественное истечение по `entitlements.expires_at` сохраняется.

Никаких изменений кода, БД, edge functions, конфига, GitHub workflows не выполнено.

**Status:** Phase 3.5-A Discovery — DONE. Phase 3.5-B Implementation — ожидает отдельного approve оператора.
