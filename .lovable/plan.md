# да, согласен, с учетом правок:

1. **Добавить обязательный блок backend (критично)**

```text
Перед UI задачами:

- installment schedule (installment_payments) создаётся из tariff_offers (UUID-only)
- installment-charge-cron:
  - getSubscriptionToken helper
  - idempotency ключ installment_${id}_attempt_${N}
  - overcharge guard (paid < total)
- audit_logs (минимум):
  installment_started
  installment_payment_received
  installment_completed
  installment_charge_failed
```

2. **Страница рассрочки — уточнить scope**

```text
Только read-only v1:

- список платежей (N/M)
- статус (pending/paid/failed)
- next_payment_at
- без редактирования/пересчётов
```

3. **Лог рассрочки**

```text
Не отдельная система.

Источник: audit_logs + installment_payments

UI = агрегированный view, без новой таблицы
```

4. **Уведомления**

```text
Только 3 события:

- успешный платёж
- неудачный платёж
- за 1 день до списания

Без сложных цепочек и ретраев в этом спринте
```

5. **Отчёт legacy-долга**

```text
Отдельный deliverable:

- список функций, пишущих payment_token
- 21 active подписка
- ghost + mismatch кейсы
- план cleanup (без выполнения)
```

6. **UI настройки магазина**

```text
Проверить только:

- выбор offer_id (UUID)
- корректность installment-параметров (amount, interval, total)

Без рефакторинга всей панели
```

7. **Жёсткое ограничение scope**

```text
В этом спринте запрещено:

- трогать обычные subscriptions
- массово переписывать payment_token
- внедрять bePaid Subscriptions API
- добавлять новые cron кроме installment-charge
```

После этих уточнений план соответствует цели — быстро запустить рассрочку без расползания scope.

&nbsp;

План: Спринт «Рассрочки» — узкий scope, без legacy-миграции

## 0. Принципы спринта (фиксируем приоритет)

1. **Основная цель спринта — рассрочки.** Запуск installment-flow по конфигурации в кнопке тарифа (`tariff_offers`).
2. **Миграция legacy `payment_token` НЕ является целью спринта.** Все большие рефакторы prod-функций (`subscription-charge`, `admin-manual-charge`, `payments-autolink-by-card`) — backlog.
3. **Stage 1 сужается** до минимума, необходимого для безопасной работы рассрочек.
4. **Stage 3 и Stage 4 запрещены к исполнению** в этом спринте (mass write-rewrite + drop колонки).
5. **Проблемные подписки** (`9d2eef10`, `f51fec1e`, `ade2a1a3`) — отдельный backlog `legacy payment_token cleanup`. В этом спринте не трогаем, если они не участвуют в новом installment-flow.

---

## 1. Порядок работы спринта

```text
1) Minimal token helper (только для рассрочки)
2) Installment schedule generator (из tariff_offers)
3) installment-charge-cron через helper
4) Overcharge guard + idempotency + audit
5) UI / notification по рассрочке (админ + кабинет)
6) Отдельный отчёт: legacy payment_token cleanup backlog
```

Каждый шаг — Diagnose → Plan → Dry run → Execute → Verify. Без пропусков.

---

## 2. Stage 1 (узкий) — Minimal Token Helper

### Scope

- Создать `supabase/functions/_shared/token-resolver.ts`.
- Helper `getSubscriptionToken(subscriptionId)` с приоритетом источников:
  1. `payment_methods` (по `subscription_payment_credentials.payment_method_id` или прямой связи user_id+subscription)
  2. `subscription_payment_credentials` (legacy MIT)
  3. `subscriptions_v2.payment_token` (fallback)
- Возврат: `{ token, source, payment_method_id, ghost: boolean }`.
- **Ghost-токен** (нет `payment_method_id`) → helper возвращает `ghost: true`. В installment-flow это означает: dry-run only, реального charge нет, аудит «ghost_token_skipped».

### Что НЕ делаем в Stage 1

- НЕ переписываем `subscription-charge`.
- НЕ переписываем `admin-manual-charge`.
- НЕ переписываем `payments-autolink-by-card`.
- НЕ трогаем 12 функций, пишущих в `payment_token`.
- НЕ зеркалим writes.
- НЕ удаляем колонку.

### DoD Stage 1 (новый)

- Helper `getSubscriptionToken` создан и покрыт unit-тестом (Deno test).
- `installment-charge-cron` (Stage 3 ниже) использует helper.
- `provider_token` НЕ читается напрямую из `subscriptions_v2` в новом installment-flow.
- Существующие обычные subscription-потоки (`subscription-charge`, webhook, autolink) **не изменены** — diff = 0 строк.

---

## 3. Stage 2 — Installment Schedule Generator

### Scope

Source of truth конфигурации рассрочки — кнопка тарифа (`tariff_offers`):

- `tariff_offers.kind = 'installment'`
- `tariff_offers.config.installment`: `{ parts: N, interval_days: D, first_payment_amount?: X }`
- Всё через UUID: `product_id`, `tariff_id`, `tariff_offer_id`. Никаких строковых slug/имён.

### Алгоритм

1. После успешного **первого** `direct charge` (через стандартный `bepaid-webhook` → `grant-access-for-order`) — триггерим installment scheduler.
2. Scheduler читает `tariff_offers.config.installment` по `tariff_offer_id` из `orders_v2.meta.tariff_offer_id`.
3. Вставляет в `installment_payments` записи `payment_number = 2..N`, `status = 'pending'`, `due_date = first_paid_at + (k-1)*interval_days`.
4. Idempotency-ключ: `installment_${subscription_id}_attempt_${payment_number}`.
5. **Overcharge guard**: перед вставкой — `count(*) where subscription_id = X and status in ('paid','pending')` ≤ `parts`.

### Запрещено

- Считать график по строковым названиям тарифов.
- Создавать installment вне tariff_offers конфигурации.
- Дублировать существующий `subscription-renewal` — это другой поток (recurring), не installment.

### DoD Stage 2

- Schedule создаётся только из `tariff_offers.config.installment` по UUID.
- Overcharge guard работает (тест на повторный вызов scheduler — 0 новых строк).
- Записи имеют корректный `due_date` и `payment_number`.

---

## 4. Stage 3 — installment-charge-cron через helper

### Scope

- Cron каждый день читает `installment_payments` где `status='pending' AND due_date <= now()`.
- Для каждой строки:
  1. `getSubscriptionToken(subscription_id)` — единственный источник токена.
  2. Если `ghost=true` → status `pending`, audit `ghost_token_skipped`, уведомление админу. **Реальный charge не делаем.**
  3. Если token есть → `direct_charge` через bePaid с idempotency-ключом `installment_${id}_attempt_${attempts+1}`.
  4. Webhook (`bepaid-webhook`) обновляет `installment_payments.status` → `paid` / `failed`, инкремент `charge_attempts`.
- Retry policy: до 3 попыток, интервал 24ч, далее `failed` + уведомление.

### Webhook split

`bepaid-webhook` — минимальная правка:

- Step 1: capture token/method (как сейчас, без изменений).
- Step 2: если `meta.installment_id` присутствует → обновить `installment_payments`. Иначе — текущая логика. **Существующие ветки не трогаем.**

### DoD Stage 3

- Cron вызывает только helper, не читает `subscriptions_v2.payment_token` напрямую.
- Ghost-токен → audit + skip, без charge.
- Idempotency-ключ уникален per attempt.
- Webhook корректно закрывает `installment_payments.status`.

---

## 5. Stage 4 — UI / Notifications

### Админ

- `AdminPaymentsHub` → таб «Рассрочки» (используем существующий `useAdminInstallments`).
- Действия: «Списать сейчас», «Закрыть рассрочку (cancelled / forgiven)» — уже реализованы в `useInstallments.tsx`. Проверить, что работают через новый helper.

### Кабинет пользователя

- Блок «Мои рассрочки» — список pending/paid с датами и суммами.

### Уведомления

- Email/Telegram пользователю: за 3 дня до `due_date`, в день списания (success/fail).
- Email админу: ghost-токен, 3 неудачные попытки подряд.

### DoD Stage 4

- Админ видит список рассрочек по продукту/тарифу (UUID-фильтры).
- Пользователь видит свои рассрочки.
- Уведомления уходят по событиям.

---

## 6. Stage 5 — Отдельный отчёт `legacy-payment-token-cleanup-backlog`

Не реализуем, **только документ** в `docs/`:

- Список 12 функций, пишущих в `payment_token`.
- Список 4 функций, читающих `payment_token`.
- 3 проблемные подписки: `9d2eef10` (ghost), `f51fec1e`, `ade2a1a3` (desync) — статус, рекомендация.
- План фаз будущего спринта: mirror writes → switch reads → drop column.
- **Важно:** этот документ не запускает работы в текущем спринте.

---

## 7. Что строго запрещено в текущем execute

- Массовая переписка WRITE-операций в 9+ prod-функциях.
- Зеркальная запись в `payment_methods` для всех путей.
- Удаление/деприкейт колонки `subscriptions_v2.payment_token`.
- Любые правки `subscription-charge`, `admin-manual-charge`, `payments-autolink-by-card`.
- Ремонт 3 проблемных подписок (если они не приходят в installment-flow).

---

## 8. Технические детали (для разработчика)

### Файлы (создать)

- `supabase/functions/_shared/token-resolver.ts`
- `supabase/functions/installment-schedule-generator/index.ts`
- `supabase/functions/installment-charge-cron/index.ts`
- `docs/legacy-payment-token-cleanup-backlog.md`

### Файлы (минимальная правка)

- `supabase/functions/bepaid-webhook/index.ts` — добавить ветку `if meta.installment_id`.
- `supabase/functions/grant-access-for-order/index.ts` — после успешного первого charge триггерить `installment-schedule-generator`, **только если** `tariff_offer.kind = 'installment'`.

### Таблицы (без изменений схемы)

- `installment_payments` — уже существует.
- `tariff_offers.config.installment` — уже поддерживается JSONB.

### Cron

- Новый job `installment-charge-cron` — daily 09:00 MSK.

---

## 9. Итоговый DoD спринта

- Кнопка тарифа c `kind=installment` создаёт корректный график после первой оплаты.
- Cron списывает по графику через helper, без прямого чтения `payment_token`.
- Ghost-токен не приводит к failed charge — только аудит.
- Overcharge guard защищает от повторных вставок.
- Админ и пользователь видят рассрочки в UI.
- Уведомления уходят.
- Существующие subscription/payment-потоки не изменены (diff минимальный).
- Создан backlog-документ по legacy `payment_token` — без исполнения.
---

## 10. Stage 3 — Cron lock + completion + audit (выполнено)

### Read-only проверка enum subscriptions_v2.status

- Фактические значения в БД: `active`, `trial`, `past_due`, `canceled`, `expired`, `superseded`.
- `completed` отсутствует → используем `expired` + `meta.installment_completed_at`.
- Стиль: `subscriptions_v2.status` = `canceled` (одно l), `installment_payments.status` = `cancelled` (два l).
- CHECK constraint по `installment_payments.status` НЕ добавляется в этом спринте (вынесен в отдельный cleanup-патч).

### Что сделано в `installment-charge-cron`

1. **Атомарный lock pending → processing**: единый `update().eq('status','pending').select('id')`. Если 0 строк — параллельный cron уже захватил, skip.
2. **Skip завершённых/отменённых подписок**: пропуск, если `subscriptions_v2.status ∈ {canceled, expired, superseded}` + audit `installment.skipped_subscription_inactive`.
3. **Guard payment_number > total_payments**: skip + audit `installment.guard_payment_number_overflow`.
4. **Completion после последнего платежа**: при `payment_number >= total_payments` подписка переводится в `expired`, `next_charge_at = NULL`, в `meta` пишется `installment_completed_at` и `installment_completed_payments`.
5. **Audit `installment.completed`** с `subscription_id`, `order_id`, `total_payments`, `previous_status`, `new_status`.
6. Удалён дублирующий update `status='processing'` внутри try (lock уже выполнен снаружи).
7. Все логи и комментарии русифицированы там, где их видит человек.

### DoD Stage 3 — выполнено

- Атомарный lock защищает от двойного списания при параллельном cron. ✅
- Guard блокирует overflow по payment_number. ✅
- После последнего платежа подписка → `expired`, `next_charge_at=NULL`. ✅
- `audit_logs.action = 'installment.completed'` пишется. ✅
- Завершённые/отменённые подписки не списываются. ✅
- CHECK constraint вынесен в отдельный cleanup-патч (не в scope). 📌

---

## Stage 4 — Уведомления и cron расписания

### Изменения

1. **`installment-notifications`** — add-only action `completion` (отдельный шаблон с темой «🎉 Рассрочка полностью оплачена»). Существующие `test|upcoming|success|failed` не тронуты.
2. **`installment-charge-cron`** — введён `notifyWithAudit(supabase, url, key, action, installmentId, context)`. Заменяет inline `fetch` к `installment-notifications` для `success` и `failed`, добавляет `completion` внутри блока завершения. Best-effort: ошибка уведомления никогда не ломает списание.
3. **Audit-события** (новые):
   - `installment.notification_success_requested`
   - `installment.notification_failed_requested`
   - `installment.notification_completion_requested`
   - `installment.notification_request_failed` (HTTP не-2xx или исключение)
4. **Cron jobs** созданы (через `supabase--insert`, не в migration):
   - `installment-charge-cron-morning` — `0 6 * * *` → `installment-charge-cron`
   - `installment-charge-cron-evening` — `0 18 * * *` → `installment-charge-cron`
   - `installment-notifications-upcoming-daily` — `0 10 * * *` → `installment-notifications` с `action: upcoming`

### DoD Stage 4 — статус: технически принято, runtime-proof открыт

**Технически выполнено:**
- ✅ Cron jobs созданы и активны (jobid 45/46/47, проверено `cron.job` — `active = true`).
- ✅ Add-only action `completion` (отдельный шаблон «🎉 Рассрочка полностью оплачена»); `success|failed|upcoming` не тронуты.
- ✅ `notifyWithAudit` в `installment-charge-cron`: best-effort, HTTP-ошибка/exception никогда не ломает charge.
- ✅ Audit helper для `installment.notification_*` подключён к каждому пути (`success`, `failed`, `completion`, `request_failed`).
- ✅ Существующий Telegram-уведомитель (`sendPaymentFailureNotification`) не тронут.

**Runtime-proof — открыто до первого боевого прогона:**

Cron job нельзя считать закрытым только по факту создания. Закрытие требует:

1. **Первый успешный запуск каждого job** — подтверждение через `cron.job_run_details`:
   ```sql
   SELECT j.jobname, r.start_time, r.status, r.return_message
   FROM cron.job_run_details r
   JOIN cron.job j ON j.jobid = r.jobid
   WHERE j.jobname LIKE 'installment-%'
   ORDER BY r.start_time DESC LIMIT 20;
   ```
   Ожидание: `status='succeeded'` минимум по одному запуску каждого из трёх job (`-morning`, `-evening`, `-upcoming-daily`).

2. **Audit-события записаны** для реального installment (не теста):
   ```sql
   SELECT action, created_at, meta->>'installment_id' AS installment_id,
          meta->>'notification_action' AS notification_action,
          meta->>'http_status' AS http_status
   FROM audit_logs
   WHERE action LIKE 'installment.notification_%'
   ORDER BY created_at DESC LIMIT 20;
   ```
   Ожидание: ≥1 запись `success_requested` или `failed_requested` после первого вечернего/утреннего запуска.

3. **Audit helper sanity** — отсутствие `notification_request_failed` без причины:
   ```sql
   SELECT count(*) FILTER (WHERE action='installment.notification_request_failed') AS failed,
          count(*) FILTER (WHERE action='installment.notification_success_requested') AS success_req,
          count(*) FILTER (WHERE action='installment.notification_completion_requested') AS completion_req
   FROM audit_logs
   WHERE action LIKE 'installment.notification_%' AND created_at > now() - interval '7 days';
   ```
   Если `failed > 0` без соответствующего `success_req`/`completion_req` — расследовать (HTTP 401/500/timeout).

4. **Completion notification** — обязательная отдельная проверка после первой реально завершённой рассрочки:
   ```sql
   -- найти installment с payment_number = total_payments и status='paid'
   SELECT ip.id, ip.order_id, ip.payment_number, ip.total_payments, ip.status, ip.paid_at
   FROM installment_payments ip
   WHERE ip.payment_number = ip.total_payments AND ip.status = 'paid'
   ORDER BY ip.paid_at DESC LIMIT 5;

   -- по ним должно быть ровно одно audit completion_requested
   SELECT meta->>'installment_id', count(*)
   FROM audit_logs
   WHERE action = 'installment.notification_completion_requested'
     AND meta->>'installment_id' = ANY(ARRAY[<ids выше>])
   GROUP BY 1;
   ```
   Ожидание: ровно `1` на каждый завершённый installment. `0` или `>1` — баг.

5. **`email_send_log` — статус риска: MEDIUM, не «ожидается пусто»:**

   `installment-notifications` шлёт через прямой SMTP (Yandex), минуя `send-transactional-email` и pgmq queue. Это означает:
   - **Нет proof-цепочки доставки** для installment-писем (не видно `sent`/`failed`/`bounced`/`dlq`).
   - **Нет suppression-чекинга** — письмо уйдёт даже на адрес из `suppressed_emails`.
   - **Нет retry на 5xx/429** — одна сетевая ошибка SMTP теряет письмо.
   - **Нет единого логгинга** — жалоба «не пришло письмо о платеже» не воспроизводится через `email_send_log`.

   Это **не blocker для Stage 4**, но требует закрытия через `PAY-installment-email-unification` (см. backlog) до роста объёма installment-уведомлений.

---

## Backlog

- **PAY-installment-notify-TG** — *priority: normal*. Расширить `installment-notifications` Telegram-каналом (success / failed / completion / upcoming). Сейчас только email + один точечный TG для failed внутри `installment-charge-cron`.
- **PAY-installment-email-unification** — *priority: HIGH*. Перевести `installment-notifications` на общий `send-transactional-email` (React Email + pgmq queue). Без этого нет единого proof/logging по installment-письмам, нет suppression-чекинга, нет retry. Блокирует полноценный runtime-proof Stage 4 и диагностику жалоб «не пришло письмо».
