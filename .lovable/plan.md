Да, согласен, с учетом правок:

1. **Название патча лучше изменить.**  
Это не “webhook fix”, а refund SOT/RPC recovery. Название:

```text
PATCH-REFUND-SOT-RPC-RECOVERY-2026-05
```

Чтобы не было ложного вывода, что проблема в webhook.

2. **Stage 1 нельзя называть read-only, если вызывается RPC даже через SAVEPOINT.**  
Формально это rollback-safe repro, но не read-only. Нужно назвать:

```text
rollback-safe DB repro
```

И выполнять только в транзакции с обязательным `ROLLBACK`.

3. **Не использовать повторный admin refund как recovery.**  
Повторный вызов `subscription-admin-actions` может снова сходить в bePaid и получить `already_refunded`, но это смешивает recovery с внешним API. Лучше:

```text
admin-repair-refund-recording
```

узкая admin-only функция, которая:

- читает `audit_logs.admin.subscription.refund_db_recording_failed`;
- берёт `bepaid_refund_uid`;
- вызывает только `record_refund_atomic`;
- не вызывает bePaid API.

4. **Ветка** `bepaidAlreadyRefunded` **должна вызывать RPC только если есть доказанный refund_uid.**  
Если bePaid вернул только текст `Payment has been refunded already`, но не дал refund uid, нельзя генерировать новый uid. Нужно брать uid из:

- original failed audit;
- webhook body;
- bePaid response, если там есть transaction.uid.

Если uid нет → `manual_review_refund_uid_missing`.

5. **Access action по Виктории не выполнять автоматически.**  
Сначала восстановить финансовую запись refund.  
Revoke/reduce/keep — отдельное admin-решение, потому что refund уже прошёл, но доступ мог измениться после 18.05.
6. **Sweep** `refund_db_recording_failed` **должен быть dry-run первым.**  
Сначала список всех failed refunds:

- order;
- parent_payment;
- refund_uid;
- amount;
- есть ли уже refund-row;
- can_repair / manual_review.

Execute recovery по sweep — отдельным approve.

7. **Не утверждать, что webhook обычно не шлёт событие после merchant API refund, если нет документации bePaid.**  
В proof писать осторожно:

```text
для этого кейса webhook refund event не найден; локальный failure был в synchronous admin path
```

Не делать общий вывод про поведение bePaid.

8. `bepaid-process-refunds` **надо классифицировать как risk/backlog, если он пишет напрямую.**  
Если он не идёт через `record_refund_atomic`, это нарушение SOT. Добавить отдельный subtask:

```text
PATCH-REFUND-POLLING-SOT-ALIGNMENT
```

но не смешивать с этим fix.

## **Ответ Lovable**

```text
План принимаю с правками.

Переименовать патч:
PATCH-REFUND-SOT-RPC-RECOVERY-2026-05

Ключевая логика верная:
- SOT записи refund = record_refund_atomic;
- UI/admin path и webhook должны сходиться в один идемпотентный RPC;
- у Виктории refund прошёл в bePaid, но локальная запись не создалась из-за падения RPC;
- чинить надо RPC и recovery, а не создавать polling-cron или direct UI write.

Правки обязательны:

1. Stage 1 назвать rollback-safe DB repro, не read-only.
Если вызывается RPC, даже через SAVEPOINT, это не read-only. Выполнять только в транзакции с гарантированным ROLLBACK.

2. Recovery Виктории делать НЕ через повторный admin refund в bePaid.
Нужна узкая admin-only функция:
admin-repair-refund-recording

Она должна:
- найти audit `admin.subscription.refund_db_recording_failed`;
- взять original `bepaid_refund_uid=6c64db37-f2a3-403c-b9c0-0749683f6b42`;
- вызвать `record_refund_atomic`;
- не вызывать bePaid API;
- не создавать новый refund uid.

3. Ветка `bepaidAlreadyRefunded` может вызывать `record_refund_atomic` только если есть доказанный refund_uid:
- из original failed audit;
- или webhook body;
- или bePaid response.
Если refund_uid нет — `manual_review_refund_uid_missing`, без записи.

4. Access action по Виктории не выполнять автоматически.
В этом патче восстановить только финансовую часть:
- refund-row;
- parent.refunded_amount;
- order refund status/meta;
- audit.
Revoke/reduce/keep access — отдельное admin-решение после восстановления финансовой записи.

5. Sweep остальных `refund_db_recording_failed`:
сначала только dry-run:
- сколько failed refunds;
- какие уже repaired;
- какие можно repair через original refund_uid;
- какие manual_review.
Recovery sweep execute — отдельный approve.

6. Не утверждать, что bePaid “обычно не шлёт webhook” после merchant API refund.
В proof формулировать только факт:
по кейсу Виктории webhook refund event не найден, а failure произошёл в synchronous admin path.

7. Проверить `bepaid-process-refunds`.
Если он пишет refund-row напрямую, это backlog-risk:
PATCH-REFUND-POLLING-SOT-ALIGNMENT.
В текущем патче не чинить, только зафиксировать.

DoD обновить:

- источник enum-cast bug локализован через rollback-safe repro;
- RPC исправлен;
- regression test зелёный;
- `bepaidAlreadyRefunded` не теряет recovery при наличии refund_uid;
- `admin-repair-refund-recording` восстановил refund Виктории без вызова bePaid API;
- financial state Виктории восстановлен;
- access action не выполнялся автоматически;
- sweep failed refunds dry-run выполнен;
- no polling-cron, no direct UI write, no duplicate SOT.
```

Коротко: **план по сути правильный**, но recovery нельзя делать повторным refund-запросом в bePaid. Нужно восстановить локальную запись через original `bepaid_refund_uid` и тот же RPC.

&nbsp;

План: PATCH-REFUND-WEBHOOK-SOT-2026-05 (final, после полного discovery)

## Diagnose — полная картина потока refund

### 1. Канонический путь refund (SOT)

```text
Админ нажал «Возврат» в RefundDialog
        │
        ▼
src/components/admin/RefundDialog.tsx
        │  supabase.functions.invoke('subscription-admin-actions', {action:'refund', order_id, refund_amount, refund_reason, access_action, reduce_days})
        ▼
supabase/functions/subscription-admin-actions/index.ts  (одна функция, без дублей)
   │
   ├─ POST https://gateway.bepaid.by/transactions/refunds   {parent_uid, amount, reason}
   │      └─ ждёт synchronous response (transaction.status ∈ {successful|failed|already_refunded})
   │
   ├─ если bePaid вернул successful → SUPABASE RPC `record_refund_atomic(...)` (single tx)
   │      ├─ idempotent guard по `provider='bepaid' AND provider_payment_id=refund_uid AND transaction_type='refund'`
   │      ├─ LOCK parent payment + order
   │      ├─ INSERT payments_v2 refund-row (amount=-X, status='refunded', transaction_type='refund', meta.parent_payment_*)
   │      ├─ UPDATE parent.refunded_amount += X
   │      ├─ UPDATE orders_v2 (status='paid' для partial, 'refunded' для full + meta агрегаты)
   │      └─ INSERT audit_logs `admin.subscription.refund_recorded`
   │
   ├─ если RPC упала → audit `admin.subscription.refund_db_recording_failed` + HTTP 500 + repair_marker
   ├─ если bePaid вернул already_refunded → audit `refund_skipped_already_refunded` (HTTP 200 идемпотентно)
   │
   ├─ access action (revoke/reduce/keep/keep_subscription)
   │      └─ обновляет subscriptions_v2 + executeRevoke()/syncEntitlement()
   │
   └─ Telegram уведомление (если revoke)
```

**Параллельный путь — bePaid webhook** (`supabase/functions/bepaid-webhook/index.ts`):

- срабатывает на любые transaction-события от bePaid (включая refund'ы, сделанные напрямую в merchant-cabinet или повторные доставки);
- detects refund по `webhookTxType==='refund' || body.refund || transaction.refund_reason`;
- кладёт в `payment_reconcile_queue` (если новое событие платежа) или сразу зовёт **тот же** `record_refund_atomic` (canonical write-path для refund-row + parent linkage, PATCH DEAL-LINKAGE-ROOT-FIXES-2026-05, строки 4466-4520);
- идемпотентность гарантирована тем же guard по `provider_payment_id` refund-uid.

**Вывод:** SOT-архитектура корректна. UI **не пишет** payments_v2 напрямую — он зовёт RPC. Webhook **не дублирует** запись — он зовёт тот же RPC с тем же идемпотентным guard'ом. Cron `bepaid-process-refunds` — третий канал (из polling/queue), тоже идёт через тот же RPC. Все три канала сходятся в одну точку `record_refund_atomic`.

### 2. Что реально случилось с refund Виктории Маргалик 2026-05-18

Audit-цепочка (target_user=`7329990d…`, order=`ORD-26-MODR5QFS` / id `78248b8d-e6ae-4269-99fc-e8fc6e420827`, parent_payment_uid=`3b64cd09…b5a` = платёж 2026-04-25 150 BYN):


| timestamp           | action                                               | actor                           | meta                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-18 11:46:39 | `admin.subscription.refund_db_recording_failed`      | `05cd3754…` (админ Сергей)      | `bepaid_refund_uid=6c64db37-f2a3-403c-b9c0-0749683f6b42`, `refund_amount=150`, `**error="invalid input value for enum payment_status: \"\""**`, `requires_manual_repair=true` |
| 2026-05-18 11:47:32 | `admin.subscription.refund_skipped_already_refunded` | `05cd3754…` (повторная попытка) | bePaid response: `{base:["Payment has been refunded already"]}` — bePaid идемпотентно отверг, наша БД повторно не пыталась записать                                           |


**Корневой баг:** RPC `record_refund_atomic` упала с Postgres ошибкой `invalid input value for enum payment_status: ""`. В тексте RPC INSERT задаёт `status='refunded'` литералом, который валиден для enum `payment_status` (`{pending, processing, succeeded, failed, refunded, canceled}`). На `payments_v2` нет custom INSERT-триггеров (только `update_updated_at_column`). На `orders_v2` есть `orders_v2_autofill_deal_month_trg` (read-only по статусу) и валидация pipeline-stage — оба не могут продуцировать enum-cast пустой строки. Источник `""` ещё не локализован — это latent bug, который надо точечно ловить минимальным репро.

**Следствие:** bePaid списал 150 BYN с карты (внешне всё прошло), но локально refund-row не создалась, parent.refunded_amount не обновился, order не помечен `refunded`, доступ Виктории не урезан. И никакие polling/webhook/CSV-импорт не помогут — потому что **они все идут через ту же сломанную RPC и упадут с той же ошибкой**.

**Подтверждение** SOT-гипотезы пользователя: webhook не получал refund-события не из-за config bePaid, а потому что refund был инициирован из нашей админки (`actor_user_id='05cd3754…'`) — bePaid synchronous response уже подтвердил refund, отдельного асинхронного webhook bePaid в такой схеме обычно не шлёт (это callback-уведомление о статусах, не о результатах API-операций самого мерчанта). Это **не баг webhook config** и **не baseline для polling**.

### 3. Инвентарь функций — дублей нет


| Функция                                                              | Назначение                                                           | Refund-точка                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `subscription-admin-actions[refund]`                                 | UI → инициация refund через bePaid + canonical write через RPC       | **primary write-path**                                                                                                                   |
| `bepaid-webhook`                                                     | приём async уведомлений bePaid (charge/refund/subscription state)    | вторичный write-path через тот же RPC                                                                                                    |
| `bepaid-process-refunds`                                             | обработка очереди `payment_reconcile_queue` (фид от webhook+polling) | третичный write-path через прямой INSERT в payments_v2 (legacy, **проверить, не дублирует ли record_refund_atomic** — отдельный backlog) |
| `record_refund_atomic` RPC                                           | единственный SECURITY DEFINER write-path                             | идемпотентный insert + update + audit в одной tx                                                                                         |
| `admin-repair-missing-payments`, `admin-bepaid-full-reconcile`, etc. | post-фактум репарация orphan/sup payments                            | НЕ пишут refund-row, только меняют orders_v2.meta                                                                                        |


Новых функций создавать не нужно. Дублей не вижу. SOT-цепочка единственная.

---

## Fix — точечный, без новых компонентов

### Stage 1 — Локализовать enum-cast bug в `record_refund_atomic`

**Не делаем правок, пока не воспроизвели ошибку.** Сначала:

**Step 1.1 — изолированный репро в `psql` (read-only через `supabase--read_query` или test migration):**

- собираем фактические значения, с которыми падает RPC для refund Виктории:
  - `p_order_id='78248b8d-e6ae-4269-99fc-e8fc6e420827'`
  - `p_parent_payment_id='c1f1a52b-30b9-4f8f-867b-b652227f0dc0'` (платёж 2026-04-25 в payments_v2 для order 78248b8d, card 2634)
  - `p_refund_uid='6c64db37-f2a3-403c-b9c0-0749683f6b42'`
  - `p_refund_amount=150`
- ставим `SAVEPOINT`, дёргаем RPC, ловим точный SQLSTATE + контекст (`GET STACKED DIAGNOSTICS`), `ROLLBACK TO SAVEPOINT` — данные не меняем.
- если упадёт с тем же сообщением — Postgres покажет в `PG_EXCEPTION_CONTEXT` номер строки/команды → точно знаем источник `""`.

**Step 1.2 — Гипотезы для проверки (по убыванию вероятности):**

1. `audit_logs.actor_type` — возможно это enum, и где-то приходит `''`. Проверить `pg_type` для колонок audit_logs.
2. Какой-то DOMAIN-constraint на `payments_v2` с CHECK-функцией, вызывающей `lower()::payment_status` или подобное.
3. Side-effect от другой RPC, вызываемой из триггера (например, после `UPDATE orders_v2` есть downstream-расчёт).
4. Параметр `p_bepaid_response` содержит поле, которое где-то кастуется в enum (через jsonb-индекс или triggerом).

**Step 1.3 — Минимальный SQL-фикс:**

- В RPC добавить явный `COALESCE(NULLIF(value,''),'pending'::payment_status::text)` для любого enum-производного значения, ИЛИ
- Поправить конкретный путь, где `""` приходит (например, audit_logs.actor_type, если оно enum и его иногда не задают).

### Stage 2 — Регрессионный тест

Создать `supabase/functions/_shared/record_refund_atomic_test.ts` (Deno test) с фикстурой:

- order paid 150 BYN, один parent-payment с card 2634, parent.refunded_amount=0;
- вызвать `record_refund_atomic` с p_refund_amount=150, p_refund_uid='test-uid-1' → ожидать success: true, idempotent: false, refund_status='full', new_order_status='refunded';
- повторный вызов с тем же uid → ожидать idempotent: true;
- НИКАКИХ side-effects на чужие orders.

### Stage 3 — Recovery конкретного refund Виктории

После того как RPC починен и регрессия зелёная:

**Step 3.1 — recovery через тот же canonical path** (НЕ direct INSERT, НЕ polling):

- однократный admin-вызов `subscription-admin-actions` с action='refund' для того же order_id с тем же refund_amount=150 и причиной «recovery after RPC fix 2026-05-18»;
- bePaid идемпотентно вернёт `already_refunded` → но текущая ветка `bepaidAlreadyRefunded` сейчас **не зовёт `record_refund_atomic**` (она только пишет audit `refund_skipped_already_refunded`). **Это второй пробел:** в ветке `bepaid_already_refunded` нужно всё равно дёрнуть `record_refund_atomic`, передав в `p_bepaid_response` исходный объект из bePaid `errors.base=["Payment has been refunded already"]` и `p_refund_uid` = uid из original failed-попытки (берём из audit `bepaid_refund_uid=6c64db37…`).
- альтернатива: добавить admin-only функцию `admin-repair-refund-recording` которая по найденному audit `refund_db_recording_failed` зовёт `record_refund_atomic` с зафиксированным bepaid_refund_uid (idempotent guard защитит от дублей).

**Step 3.2 — verify через UI:**

- в карточке Виктории Маргалик → вкладка «Платежи» появилась строка «Возврат 150 BYN • 18 мая 2026 • ****2634»;
- order `ORD-26-MODR5QFS` → status='refunded', meta содержит `refund_amount=150`, `refunded_at`, `paid_sum=150`;
- /admin/payments статистика «Возвраты» за май = 480,00 / 3 шт;
- access Виктории к Gorbova Club: либо отозван (если access_action='revoke'), либо урезан (если 'reduce'), либо оставлен — по требованию администратора.

### Stage 4 — Sweep остальных `refund_db_recording_failed` за всё время

```sql
SELECT count(*), min(created_at), max(created_at)
FROM audit_logs
WHERE action='admin.subscription.refund_db_recording_failed';
```

Если есть ещё кейсы — пройти по ним тем же recovery-вызовом (idempotent RPC безопасен). Если 0 кроме Виктории — записать в proof.

---

## Что **НЕ делаем** (явные anti-goals по запросу пользователя)

- ❌ НЕ создаём cron-polling каждые 30 минут как основной механизм синхронизации refund;
- ❌ НЕ пишем refund-row напрямую из UI/admin-функции в обход `record_refund_atomic`;
- ❌ НЕ меняем `ContactPaymentsTab` (фильтр корректен);
- ❌ НЕ меняем схему `payments_v2` / enum `payment_status`;
- ❌ НЕ обходим `record_refund_atomic`;
- ❌ НЕ делаем CSV-импорт «Выписки BePaid» основным каналом refund-синхронизации;
- ❌ НЕ создаём новые edge-функции — recovery делаем через существующий `subscription-admin-actions` или новый узкий `admin-repair-refund-recording`, который только вызывает существующий RPC;
- ❌ НЕ трогаем `bepaid-webhook`, `grant-access-for-order`, `subscriptions_v2`, RLS, cron.

---

## Файлы

- **investigate (read-only):** запрос к RPC с фикстурой Виктории через SAVEPOINT, чтобы поймать точный source `""` в enum.
- **edit (после Stage 1.2):** `supabase/migrations/<ts>_fix_record_refund_atomic_enum_cast.sql` — точечный fix внутри RPC.
- **create:** `supabase/functions/_shared/record_refund_atomic_test.ts` — Deno regression test.
- **edit:** `supabase/functions/subscription-admin-actions/index.ts` — в ветке `bepaidAlreadyRefunded` добавить вызов `record_refund_atomic` (idempotent), чтобы recovery шёл через тот же canonical path.
- **create proof:** `.lovable/proofs/patch_refund_webhook_sot_2026_05.md` — фиксация audit-цепочки, root cause SQL, fix diff, recovery audit, verify-SQL.
- **memory update:** добавить запись `mem://architecture/payments/refund-canonical-write-path` с явным указанием: «SOT = `record_refund_atomic`; UI / webhook / polling — три канала, всё через идемпотентный RPC; в ветке `bepaid_already_refunded` обязательно вызывать RPC для recovery».

---

## DoD

1. ✅ Точно локализован источник `""` в enum-cast (с PG_EXCEPTION_CONTEXT в proof).
2. ✅ Миграция с RPC-фиксом применена, регрессионный Deno-тест зелёный.
3. ✅ Ветка `bepaidAlreadyRefunded` теперь зовёт `record_refund_atomic` (для idempotent recovery).
4. ✅ Recovery refund Виктории отработал: refund-row в `payments_v2` с uid `6c64db37…6b42`, parent.refunded_amount=150, order.status='refunded', audit `admin.subscription.refund_recorded` (post-fix).
5. ✅ В UI: карточка контакта показывает «Возврат 150 BYN», /admin/payments статистика 480/3.
6. ✅ Sweep остальных `refund_db_recording_failed` — все обработаны.
7. ✅ Proof файл с полной audit-цепочкой создан.
8. ✅ Memory `refund-canonical-write-path` обновлено.
9. ✅ Никакого polling-cron, никакого UI-direct-write, никакого изменения SOT.

---

## Резюме

- **SOT** = bePaid synchronous API response (для admin-initiated refund) + bePaid webhook (для external refund) → оба канала через идемпотентный RPC `record_refund_atomic`.
- **Реальный bug** = одна latent ошибка enum-cast в RPC, сломавшая запись refund Виктории 2026-05-18. CSV-rsync последний раз 2026-05-14 — это симптом, не причина.
- **Polling/cron не нужен** — webhook + sync response покрывают все каналы; их единственная точка отказа — RPC, которую и чиним.
- **UI не пишет напрямую** — он зовёт edge-функцию, которая зовёт RPC.
- **Дублей функций нет** — три канала сходятся в один SOT-RPC.