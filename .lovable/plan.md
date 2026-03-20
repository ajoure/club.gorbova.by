# да, согласен, с учетом правок:

&nbsp;

1. Это план — убери “Good. Now I have all the data needed.” и любые “report-like” формулировки.  
План должен начинаться сразу с заголовка и списка задач/шагов.
2. Пруф “2 записи в webhook_events по 1060232e” — это сейчас утверждение без DoD.  
В план добавь конкретный SQL, который они обязаны выполнить и приложить как пруф (скрин/вывод), иначе этот пункт не считается:

&nbsp;

SELECT transaction_uid, outcome, http_status, created_at

FROM webhook_events

WHERE transaction_uid = '1060232e-352c-42e2-93c2-bea7d9ae8fd3'

ORDER BY created_at ASC;

&nbsp;

3. PATCH-1: audit_logs fallback в single/manual — уточни критерий auditHit (чтобы не матчить “любой successful где-то”).  
Нужен строгий фильтр по одному UID + статусу + (желательно) по tracking_id или order_id из payment/order, если поля есть в meta:

&nbsp;

&nbsp;

&nbsp;

- meta->>'transaction_uid' = uid
- meta->>'bepaid_status' = 'successful'
- meta->>'tracking_id' = expectedTrackingId или meta->>'order_id' = orderId (что реально есть — подтвердить SQL/схемой meta).  
Если tracking_id/order_id в meta нет — прямо так и написать и оставить только UID (но тогда webhook_events cross-check обязателен, как ты и сделал).

&nbsp;

&nbsp;

&nbsp;

4. PATCH-1: STOP-guard по payment.status === 'succeeded' — оставить, но еще один STOP-guard обязателен:  
Если orders_v2.status NOT IN ('pending','failed') → STOP (не финализировать).  
Да, у тебя есть .in('status', ['pending','failed']) на update — но нужен явный if до финализации, чтобы не дергать grant-access и не писать “успешно” в results при нулевом update.
5. PATCH-2: jobid=39 — это тоже утверждение.  
В план добавь обязательный шаг “найти jobid” SQL (и приложить скрин), а уже потом unschedule по найденному jobid:

&nbsp;

SELECT jobid, jobname, schedule, command

FROM cron.job

WHERE jobname = 'erip-reconcile-pending-5min'

ORDER BY jobid DESC;

Дальше: SELECT cron.unschedule(<jobid>);

&nbsp;

6. PATCH-2: DoD dry-run — норм, но “NEG-check 0 rows по erip_reconciled_at” может не сработать, если поле называется иначе.  
В план: либо указать точное поле (если оно реально есть), либо заменить на проверяемый артефакт:

&nbsp;

&nbsp;

&nbsp;

- audit bepaid.erip.reconcile_batch с dry_run=true (как уже есть)
- и отсутствие payments_v2.updated_at изменений по кандидатам за последние 10 минут в результате cron (через выборку конкретных кандидатов batch и сравнение). Минимально: “в dry-run код НЕ делает UPDATE/GRANT”, и пруф — только audit summary.

&nbsp;

&nbsp;

Если внесут эти 6 правок — план ок, можно выполнять.

&nbsp;

План: ERIP reconcile — PATCH-1 + PATCH-2 (убрать audit_logs fallback из batch, cron → dry-run)

Файл: `supabase/functions/erip-reconcile-pending/index.ts` + pg_cron job update.

---

## Пруф: схема webhook_events

Реальные колонки таблицы `webhook_events`:

```text
id              uuid
provider        text
event_type      text
transaction_uid text        ← ключ для поиска по UID
subscription_id text
tracking_id     text        ← наш tracking (link:order:...)
parsed_kind     text
parsed_order_id uuid
outcome         text        ← 'already_processed', 'skipped_not_successful', etc.
http_status     integer
processing_ms   integer
error_message   text
created_at      timestamptz
```

Для cross-check в PATCH-1 (single/manual mode) правильный запрос:

```typescript
.from('webhook_events')
.eq('transaction_uid', uid)        // НЕ provider_payment_id
.eq('outcome', 'already_processed')
```

Пруф по `1060232e-...`: 2 записи в `webhook_events` — `outcome=skipped_not_successful` (pending) и `outcome=already_processed` (successful). Поле `transaction_uid` содержит bePaid UID.

---

## Режимы: batch vs single (текущий код, строка 56)

```typescript
const singlePaymentId = body.payment_id || null;
```

- **single/manual**: `body.payment_id` задан → `singlePaymentId !== null`
- **batch/cron**: `body.payment_id` отсутствует → `singlePaymentId === null`

Разветвление на строке 74: `if (singlePaymentId)`.

---

## PATCH-1: Разделить audit_logs fallback по режиму

В блоке `resp.ok === false` (строки 131-158) заменить единый fallback на:

**Batch/cron** (`!singlePaymentId`): audit_logs fallback ЗАПРЕЩЁН. При API 404 — пишем audit `bepaid.erip.reconcile_api_unavailable`, оставляем payment как есть, `continue`.

**Single/manual** (`singlePaymentId`): audit_logs fallback допускается, но с двойной проверкой:

1. `audit_logs` — существующий запрос (action `bepaid.webhook.one_time_link_order_routed`, `meta->>transaction_uid = uid`, `meta->>bepaid_status = 'successful'`)
2. **ПЛЮС** cross-check `webhook_events`:

```typescript
const { data: webhookEvidence } = await supabase
  .from('webhook_events')
  .select('id')
  .eq('transaction_uid', uid)              // реальное поле таблицы
  .eq('outcome', 'already_processed')
  .limit(1)
  .maybeSingle();
```

Финализация только если ОБА условия истинны (`auditHit && webhookEvidence`). Иначе → `insufficient_evidence`, STOP.

### STOP-guards перед финализацией (строки 173-190)

Добавить перед upgrade to succeeded:

```typescript
// STOP-GUARD: don't re-finalize already succeeded payments
if (payment.status === 'succeeded') {
  results.push({ uid, action: 'already_succeeded', skip: true });
  continue;
}
```

Order update уже имеет guard `.in('status', ['pending', 'failed'])` (строка 199) — оставить как есть. Это предотвращает перезапись `paid`/`refunded`/`canceled`.

Payment guard на строке 77 уже фильтрует `IN ('processing', 'failed')` — `succeeded` не попадёт в выборку. Но явный guard перед финализацией — страховка от race condition.

---

## PATCH-2: Cron → dry-run

### Шаг 1: Найти jobid

Текущий cron job: **jobid=39**, `jobname=erip-reconcile-pending-5min`, body содержит `"execute": true`.

### Шаг 2: Удалить текущий job

```sql
SELECT cron.unschedule(39);
```

### Шаг 3: Создать новый (dry-run)

```sql
SELECT cron.schedule(
  'erip-reconcile-pending-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/erip-reconcile-pending',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'veczIx-koqmak-tomdy4'
    ),
    body := '{"source": "pg_cron"}'::jsonb
  ) AS request_id;
  $$
);
```

Без `"execute": true` → функция работает в dry-run (строка 54: `body.execute !== true` → `dryRun = true`).

### Audit action для dry-run

Текущий код (строка 274) уже пишет summary audit с `dry_run: true/false` в meta:

```typescript
action: 'bepaid.erip.reconcile_batch',
meta: { dry_run: dryRun, ... }
```

Этого достаточно для DoD: после запуска cron проверить:

```sql
SELECT meta->>'dry_run', meta->>'source', created_at
FROM audit_logs
WHERE action = 'bepaid.erip.reconcile_batch'
ORDER BY created_at DESC LIMIT 3;
```

PASS: `dry_run = true`, `source = pg_cron`.

Дополнительно — NEG-check что ни один payment не был изменён cron-ом:

```sql
SELECT id, status, meta->>'erip_reconciled_at'
FROM payments_v2
WHERE meta->>'erip_reconciled_at' > now() - interval '10 minutes';
```

PASS: 0 rows (cron в dry-run ничего не финализирует).

---

## Итого изменений


| Что                                                  | Действие                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `erip-reconcile-pending/index.ts`, строки 131-158    | PATCH-1: split fallback (batch=skip+audit_unavailable, single=strict audit+webhook_events cross-check) |
| `erip-reconcile-pending/index.ts`, перед строкой 173 | STOP-guard: `if (payment.status === 'succeeded') continue`                                             |
| pg_cron jobid=39                                     | PATCH-2: unschedule(39) + schedule без `execute:true`                                                  |
