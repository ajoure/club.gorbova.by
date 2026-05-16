## да, согласен, с учетом правок:

1. **В Stage 3 исправить статус** `trialing`**.**  
Ранее в системе использовались статусы `active`, `trial`, `past_due`. Нужно не писать `trialing`, если такого enum нет. Формулировка:

```text
WHERE status IN ('active','trial')
```

и отдельно:

```text
WHERE status IN ('active','trial','past_due')
```

Если enum реально содержит `trialing`, это нужно подтвердить schema verification.

2. **G25 искать не по** `id='<sbs_50a3bd75…>'`**.**  
`sbs_50a3bd75…` — это provider subscription id, не `subscriptions_v2.id`. Правильно:

```text
provider_subscriptions.provider_subscription_id = 'sbs_50a3bd75a025455b'
```

и через него получить связанную `subscriptions_v2`.

3. **Stage 1 не ограничивать только** `meta->>'is_rebill'='true'`**.**  
Нужно проверить фактические поля audit. Если `is_rebill` не пишется, можно пропустить реальные autocharge. Добавить fallback-поиск по:

```text
provider_payment_id / bepaid_transaction_uid / parent_uid / subscription_id / sbs / payment_flow='bepaid_subscription_charge'
```

4. **Stage 2.D не смешивать direct writes в других canonical/repaired functions с blocker.**  
Если direct write найден не в `bepaid-webhook`, а в approved repair/admin/manual function, его классифицировать отдельно. Blocker для `mode=on` — именно тот direct access write, который может сработать на bePaid payment/rebill path.
5. **Stage 3 active duplicate pairs считать по** `(user_id, product_id, tariff_id)`**, а не только** `(user_id, product_id)`**.**  
Иначе разные тарифы одного продукта попадут как ложный duplicate. Для отдельного backlog можно дать `tariff_mismatch_pairs`.
6. `extended_by_orders duplicates` **проверять не через** `cleanup_batch`**.**  
Нужно прямое условие:

```text
jsonb_array_length(extended_by_orders) != count(distinct elements)
```

или эквивалентный разбор JSON массива. `cleanup_batch` не является признаком дубля.

7. **Рабчевская / Алёна / Багинская — не через chat_search как основной источник.**  
Основной источник — proof-файлы и БД. `chat_search` только как вспомогательный контекст. В proof указать фактические строки/статусы из БД.
8. **Stage 5 “незакрытые data repairs execute pending” сделать blocker только если влияет на active/rebill path.**  
Исторический repair без риска для новых webhook не должен автоматически блокировать `mode=on`.
9. **Добавить explicit runtime check после последнего deploy.**  
Для Stage 1/2 важно считать период после последнего deploy `bepaid-webhook`, а не только 14 дней. В proof сделать две колонки:

```text
last_14_days
since_last_deploy
```

10. **Добавить итоговую таблицу решений:**

```text
Item | Status | Blocks mode=on? | Required action | Owner patch
```

Это поможет не утонуть в proof.

После этих правок план можно запускать как read-only H4 preconditions refresh. Никаких DML, provider API и изменения `BEPAID_REBILL_MATERIALIZATION`.

&nbsp;

План: H4 preconditions refresh — read-only inventory

**Цель:** собрать единый proof-документ с финальным списком blockers/warnings/ready перед включением `BEPAID_REBILL_MATERIALIZATION=on`. Без DML, без migrations, без provider API, без изменения секрета, без `mode=on`.

**Proof:** `.lovable/proofs/h4_rebill_materialization_on_preconditions_refresh_2026_05.md`

**Frozen cutoff:** `snapshot_at = now()` фиксируется в Stage 0 и используется во всех запросах.

---

### Stage 0 — Frozen cutoff + контекст

- `snapshot_at = now()` (Minsk).
- Зафиксировать в proof: текущее значение `BEPAID_REBILL_MATERIALIZATION` (через `secrets--fetch_secrets`, без update).
- Зафиксировать последние deploy timestamps `grant-access-for-order` и `bepaid-webhook` (из edge function logs, первая запись после deploy).

---

### Stage 1 — REBILL materialization (dry_run телеметрия)

Источники: `audit_logs`, `bepaid-webhook` edge logs.

Запросы (read-only SQL через `supabase--read_query`):

1. `audit_logs WHERE action LIKE 'bepaid.rebill.%' AND created_at >= snapshot_at - interval '14 days'` — разбивка по `action` (`dry_run`, `planned`, `dispatcher_error`, `conflict_uid`, `sbs_mismatch`, `skipped_*`).
2. `audit_logs WHERE action LIKE 'bepaid.webhook.%' AND meta->>'transaction_type' IN ('authorization','payment') AND meta->>'is_rebill'='true'` — все боевые autocharge после deploy.
3. JOIN (1)↔(2) по `order_id` / `meta.bepaid_transaction_uid` — для каждого реального autocharge должна быть ровно одна `bepaid.rebill.dry_run` запись с `planned_*` полями (order_id, tariff_id, access_days, next_charge_at_suggested).
4. Аномалии: autocharge без dry_run, dry_run без autocharge, несколько dry_run на один UID, `dispatcher_error`/`conflict_uid`/`sbs_mismatch` ≠ 0.

В proof — таблица: `autocharges_total`, `dry_run_emitted`, `missing_dry_run`, `dispatcher_errors`, `conflict_uid`, `sbs_mismatch`, примеры строк (sub_id, order_id, action, meta-выжимка).

---

### Stage 2 — Direct access writes (canonical write-path enforcement)

Цель: подтвердить, что все 4 ветки идут через `grant-access-for-order`, и найти остаточные direct writes.

A. **LINK-ORDER** — статический поиск в `bepaid-webhook/index.ts` в ветке `link_order`: `subscriptions_v2 insert/update` (с `access_*`/`status`), `entitlements insert/update`, `telegram-grant-access invoke`. Ожидание: 0.

B. **WEBHOOK-SUBSCRIPTION** (recurring autocharge ветка) — то же самое: подтвердить, что ветка делегирует в writer и/или провайдер-sync UPDATE содержит ТОЛЬКО разрешённые 5 полей (`billing_type`, `auto_renew`, `next_charge_at`, `payment_method_id/token`, `meta.bepaid_*`). Поля доступа (`access_start_at`/`access_end_at`/`status`/`canceled_at`/`is_trial`) — 0.

C. **3DS finalize** — подтвердить (H2.1b-ii closed). Проверить `bepaid-webhook` 3DS handover region: 0 запрещённых паттернов (уже подтверждено в proof, перепроверить статически).

D. **H2.1c legacy one-time path** — `rg`-сканирование по всему `supabase/functions/**`:

- `\.from\(['"]subscriptions_v2['"]\).*\.(insert|update|upsert)` с access-полями;
- `\.from\(['"]entitlements['"]\).*\.(insert|update|upsert)` с `expires_at`;
- `\.from\(['"]access_rules['"]\).*\.(insert|update|upsert)` вне `product-access-grants`;
- прямые invoke `telegram-grant-access` вне `grant-access-for-order` и canonical paths.

   Каждое попадание классифицировать: canonical / legitimate (admin manual / repair / migration) / **legacy one-time direct write** (потенциальный H2.1c blocker). Дать file:line + цитата + classification.

В proof — матрица 4 веток × {static check / runtime audit за 14d / verdict}.

---

### Stage 3 — Duplicate subscriptions

Read-only через `supabase--read_query`:

1. Active duplicate pairs (новый детерминированный фильтр, тот же что в H3.x-c):
  ```
   SELECT user_id, product_id, COUNT(*) 
   FROM subscriptions_v2 
   WHERE status IN ('active','trialing') AND auto_renew=true
   GROUP BY 1,2 HAVING COUNT(*) > 1
  ```
2. То же с `status IN ('active','trialing','past_due')`.
3. G25 статус: `WHERE id='<sbs_50a3bd75…>'` — current status / auto_renew / access_end_at / canceled_at.
4. Новые пары после H3.x-a deploy: те же запросы с фильтром `created_at >= h3xa_deploy_at`.
5. `extended_by_orders` дубликаты (если есть отдельный признак): `meta->>'cleanup_batch'` ≠ 'h3x_d_…' и duplicate-флаги.

В proof — все ID, ФИО контактов через JOIN `profiles`, классификация (Cluster A/B/D/G25/новый/Рабчевская/Алёна-Багинская/extended_by_orders).

---

### Stage 4 — Data repairs status board

Таблица: задача / статус / proof-ссылка / остаток.

- H3.x-b A — closed (proof)
- H3.x-b B — closed (proof)
- H3.x-c classification + provider-pull — closed
- H3.x-d cleanup — closed (8/8)
- **G25** — hold до 2026-05-18 06:00 UTC, нужен repeat provider pull
- **Рабчевская** — dry-run в H2.1b-ii proof, execute не выполнен
- **Алёна / Багинская** — найти упоминания (chat_search + grep по proofs), статус
- **extended_by_orders duplicates** — если Stage 3 нашёл, list + классификация

---

### Stage 5 — Preconditions verdict

Финальный блок в proof:

**Blockers (mode=on запрещено пока не закрыто):**

- любая аномалия Stage 1 (autocharge без dry_run, dispatcher_error > 0, conflict_uid > 0, sbs_mismatch > 0);
- любой legacy one-time direct write из Stage 2.D, классифицированный как blocker;
- active duplicate pairs > 0 в Stage 3.1;
- незакрытые data repairs со статусом «execute pending» (Рабчевская, etc.) — если они на active subscriptions.

**Warnings (включать можно, но с риском):**

- past_due duplicate без access (Stage 3.2 минус Stage 3.1);
- G25 на hold;
- единичные `skipped_*` в Stage 1, объяснимые SOT-логикой.

**Ready:**

- список branches/repairs, который точно зелёный.

**Что сделать до `mode=on`:**

- упорядоченный action list с DoD на каждый blocker.

---

### Запрещено

- DML / migrations / provider API / Telegram invocations / `grant-access-for-order` calls;
- изменение `BEPAID_REBILL_MATERIALIZATION`;
- `mode=on`;
- любые edits в production коде (только чтение + новый proof-файл).

### Разрешено

- `supabase--read_query` (SELECT-only);
- `supabase--edge_function_logs` / `supabase--analytics_query` (read);
- `secrets--fetch_secrets` (read значения флага);
- `rg` / `code--view` по репозиторию;
- `chat_search` для поиска контекста по Рабчевская / Алёна / Багинская;
- запись ОДНОГО нового proof-файла.

### DoD

1. Proof-файл создан с 5 stages + frozen `snapshot_at` + цитаты source-кода + SQL-результаты.
2. Stage 5 содержит явный verdict: `mode=on` = `BLOCKED` или `READY` с numbered list причин.
3. Никаких изменений в DB / secrets / production коде. Migrations=0, DML=0, provider API=0.
4. Список ФИО контактов по всем затронутым подпискам из Stage 3.