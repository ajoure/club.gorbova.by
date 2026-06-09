да, согласен, с учетом правок:

План принят. Approve на R1 + R2 и на порядок закрытия хвостов.

**Подтверждаю EXECUTE**

Разрешаю:

R1 — Stripe refund hot fix / recording desync repair

R2 — Webhook delivery gap diagnose + idempotent ensure-webhook

После R1/R2 сохраняем порядок:

Phase 1 → Phase 2 → Phase 4 → Phase 5 → Phase 6 → Phase 3(cancel) → Phase 7

&nbsp;

**Обязательные правки к R1**

**1. Сначала Stripe API verify**

Перед admin-repair-refund-recording обязательно подтвердить реальный refund object в Stripe:

payment_intent = pi_3TgMkD6UYJj2vm0G1ZUpRzvH

refund_id = re_...

amount = 5.00 BYN

status = succeeded

livemode = true

Если re_... не найден — STOP.

В этом случае нельзя вызывать admin-repair-refund-recording, потому что repair должен только записывать уже существующий refund, а не создавать его задним числом.

**2. Если refund object найден**

Тогда разрешаю:

admin-repair-refund-recording

Параметры:

parent_payment_id = 2d40bc7e-e69f-4633-88d5-102561e49a54

refund_uid = реальный re_... из Stripe

refund_amount = 5.00

currency = BYN

refund_reason = stripe_dashboard_refund_backfill

access_action = keep

**3. Никаких прямых UPDATE**

Запрещено напрямую менять:

payments_v2

orders_v2

entitlements

access_grant_ledger

Все изменения только через canonical recovery path:

admin-repair-refund-recording → record_refund_atomic / record_refund_atomic_multi

**4. Доступ Сергея не отзывать**

Для этого кейса:

access_action = keep

Entitlement и доступ Сергея должны остаться active.

&nbsp;

**Expected post-state после R1**

После repair ожидаю:

**payments_v2**

refunded_amount = 5.00

refund status/meta заполнены

исходный платеж не удалён

provider = stripe

**orders_v2**

commercial_status = refunded

или equivalent refunded-marker, который уже используется для bePaid parity

**UI**

Refund должен отобразиться во всех точках:

/admin/payments

карточка сделки ORD-26-00167

блок «Оплаты»

KanbanDealCard

/admin/deals фильтр «Возврат»

Purchases.tsx / кабинет

OrderListItem.tsx

Если хотя бы в одной точке refund не отображается — это UI parity bug. Исправлять точечно через общий helper статусов, не дублировать логику по компонентам.

&nbsp;

**Proof R1**

Создать:

.lovable/proofs/stripe_refund_hot_fix_ord_26_00167_[v1.md](http://v1.md)

В proof обязательно включить:

1. Stripe API snapshot refund object.
2. Подтверждение livemode=true.
3. До/после SQL по payments_v2.
4. До/после SQL по orders_v2.
5. Audit записи.
6. Скриншоты всех UI-точек.
7. Подтверждение access_action=keep.
8. Подтверждение, что entitlement Сергея не отозван.
9. Подтверждение bePaid untouched.

&nbsp;

**Правки к R2**

Approve на diagnose + ensure-webhook.

**Что можно делать**

- проверить live Stripe endpoint;
- сверить enabled events;
- сверить webhook secret/account_code;
- проверить, почему charge.refunded не дошёл;
- запустить stripe-ensure-webhook, если он idempotent и не создаёт дубли endpoint.

**Что нельзя делать**

- создавать второй webhook endpoint, если актуальный уже существует;
- менять Stripe secrets вручную;
- ломать test/live routing;
- делать dashboard resend как обязательный путь;
- менять bePaid.

**Важное уточнение по событиям**

Не хардкодить неподдерживаемые event types. Нужно сверить фактический список событий, который принимает Stripe, и включать только валидные события.

Минимально для refund delivery должен быть покрыт:

charge.refunded

Если проект также поддерживает refund lifecycle events — проверить их фактические имена через Stripe API/endpoint config.

&nbsp;

**Proof R2**

Создать или включить в R1 proof отдельный блок:

.lovable/proofs/stripe_refund_webhook_delivery_gap_[v1.md](http://v1.md)

Содержимое:

- endpoint id;
- enabled_events before/after;
- подтверждение live endpoint;
- account_code;
- root cause, почему refund event не попал;
- результат stripe-ensure-webhook;
- подтверждение, что дубли endpoint не созданы.

&nbsp;

**Статус Phase 3 после R1/R2**

Если R1 подтверждает live refund object livemode=true и repair корректно отразил его в UI, то refund-часть Phase 3 можно считать закрытой как:

Live production refund gate = PASS via repair of real Stripe refund

Но cancel-часть остаётся отдельно:

Live production cancel gate = DEFERRED / separate approve

&nbsp;

**Дальше порядок сохраняется**

После R1/R2:

1. Phase 1 — final verify hard cleanup

2. Phase 2 — backup tables decision

3. Phase 4 — saved cards compatibility

4. Phase 5 — unified subscriptions UI

5. Phase 6 — historical card-data backfill check

6. Phase 3 cancel — live cancel gate, отдельный approve

7. Phase 7 — final closure report

Начинай с R1.1 Stripe API verify. Если refund object re_... найден — выполняй R1.2 canonical recording.

&nbsp;

План: Stripe refund parity (hot fix) + закрытие хвостов Stripe sprint

## Diagnose (что уже подтверждено)

- В БД по `pi_3TgMkD6UYJj2vm0G1ZUpRzvH`:
  - `payments_v2.status='succeeded'`, `refunded_amount=0`, `meta.refund_status` отсутствует.
  - `orders_v2` ORD-26-00167 — `Оплачен`, без refund-маркеров.
- В `provider_events` за последние 2 дня — только `checkout.session.completed`. Событий `charge.refunded` / `refund.created` / `refund.updated` не пришло, хотя `stripe-ensure-webhook` подписан на `charge.refunded`.
- В коде канонический путь существует и корректный:
  - `stripe-admin-refund` → Stripe API → webhook `charge.refunded` → `record_refund_atomic_multi`.
  - `admin-repair-refund-recording` — допустимый recovery write-path (super_admin, без повторного вызова Stripe).
- UI-бейджи `Возврат` уже существуют в `PaymentsTable.tsx`, `AdminDeals.tsx`, `KanbanDealCard.tsx`, но триггерятся только когда `status='refunded'` / `refunded_amount>0` / `commercial_status='partial_refund'` (см. memory Partial Refund State).

Вывод: refund по факту произведён на стороне Stripe (вероятно через Dashboard или прошлой версией функции), но событие не попало к нам — поэтому ни один UI-маркер не сработал. Это классический «recording desync», для которого и существует `admin-repair-refund-recording`.

## Принципы

- Один canonical write-path: `record_refund_atomic` / `record_refund_atomic_multi`. Никаких прямых UPDATE `payments_v2`/`orders_v2`.
- bePaid trigger-flow не трогать. Все изменения — на Stripe-стороне и в общих UI-компонентах статусов.
- Любые массовые операции — только после dry-run.

---

## Phase R1 — Hot fix: отразить выполненный refund 5 BYN

### R1.1 Verify on Stripe

- Через `stripe-list-events` / Stripe API подтянуть по `payment_intent=pi_3TgMkD6UYJj2vm0G1ZUpRzvH`:
  - наличие refund object (id `re_…`), amount, currency, status `succeeded`, created_at.
  - наличие/отсутствие webhook delivery (`charge.refunded`).
- Если webhook не дошёл — зафиксировать причину (account_code mismatch, endpoint, signing secret) и поправить только если это блокирует replay.

### R1.2 Recording через canonical recovery path

- Вызвать `admin-repair-refund-recording` с явными параметрами:
  - `parent_payment_id` = `2d40bc7e-…`
  - `refund_uid` = реальный `re_…` из Stripe (без выдумывания)
  - `refund_amount` = 5.00, `currency` = BYN
  - `refund_reason` = `stripe_dashboard_refund_backfill`
- Функция идемпотентна по `refund_uid`; повторный запуск — no-op.
- Никаких access_action; доступ Сергея сохраняем (политика по умолчанию `keep`).

### R1.3 Expected post-state

- `payments_v2.refunded_amount = 5.00`, появляется refund-row (если такова модель) либо `meta.refund_status='refunded'`.
- `orders_v2.commercial_status='refunded'` (full refund == amount).
- Audit `stripe.refund.repaired_via_admin_repair`.

### R1.4 UI verify (паритет с bePaid)

Проверить отображение во всех точках, где для bePaid уже работает:

1. `/admin/payments` — строка платежа: бейдж `Возврат` (rose), `refunded_amount` отображается.
2. Карточка сделки ORD-26-00167 (скрин пользователя):
  - бейдж сделки: `Оплачен` → `Возврат` (red).
  - блок «Оплаты»: бейдж платежа `Возврат` вместо `Оплачен`, под суммой строка «Возврат 5,00 Br».
3. Kanban-карточка сделки — иконка `XCircle`, цвет `text-red-400`.
4. `/admin/deals` фильтр «Возврат» — сделка попадает в выдачу.
5. `Purchases.tsx` (кабинет Сергея) — order помечен как возврат, payment-row — `Возврат`.
6. `OrderListItem.tsx` — тот же бейдж.

Если в каком-то месте бейдж не появляется — это UI-bug, чинить точечно в общем хелпере статусов, без дублирования логики.

### R1.5 Proof

- Создать `.lovable/proofs/stripe_refund_hot_fix_ord_26_00167_v1.md`:
  - Stripe API snapshot refund.
  - До/после SQL по `payments_v2` + `orders_v2`.
  - Скриншоты 6 UI-точек.
  - Подтверждение «bePaid untouched».

### DoD R1

- refund 5 BYN отражён во всех 6 UI-точках идентично bePaid.
- Запись прошла только через canonical recovery path.
- Доступ Сергея не отозван.

---

## Phase R2 — Webhook delivery gap (root cause)

Цель: исключить повторение «refund сделан, в UI не виден».

- Diagnose: проверить в Stripe Dashboard endpoint(ы) и их `enabled_events` (live), сверить с `ENABLED_EVENTS` из `stripe-ensure-webhook`.
- Если найден gap — перезапустить `stripe-ensure-webhook` (idempotent).
- Добавить лёгкий мониторинг: ежедневная проверка, что для каждого Stripe refund в API есть соответствующая запись в `payments_v2` за последние 24ч (read-only diff). Реализация — в backlog, если приоритет позволит.

### DoD R2

- Подтверждено, что `charge.refunded` / `refund.created` / `refund.updated` подписаны на актуальном live endpoint.
- Если был gap — зафиксирован root cause и proof.

---

## Phase 1–7 — без изменений (закрытие Stripe sprint)

Дальше идём строго по присланному порядку, с учётом, что R1+R2 теперь часть Phase 3 (live refund gate) как уже исполненный реальный кейс:

1. Phase 1 — final verify hard cleanup.
2. Phase 2 — backup tables decision (ждём отдельный approve на DROP).
3. Phase 4 — saved cards compatibility.
4. Phase 5 — unified subscriptions UI.
5. Phase 6 — historical card-data backfill check.
6. Phase 3 — live cancel gate (refund-часть закрывается через R1; cancel остаётся отдельным approve).
7. Phase 7 — final closure report (включая R1+R2 как доказательство Stripe refund production-ready).

---

## Что прошу подтвердить перед EXECUTE

- Approve Phase R1: backfill refund по `re_…` через `admin-repair-refund-recording` с `access_action=keep`.
- Approve Phase R2 diagnose+ensure-webhook (idempotent, без побочных эффектов).
- Подтверждение, что порядок Phase 1 → 2 → 4 → 5 → 6 → 3(cancel) → 7 остаётся в силе.

После approve начну с R1.1 (Stripe API verify) и R1.2 (canonical recording).