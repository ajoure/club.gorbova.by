да, согласен, с учетом правок:

1. **Webhook-flow — главный приоритет.**  
Cron остаётся только safety net. В плане явно зафиксировать: после оплаты `grant-access-for-order` обязан сразу запускать secondary helper и продлевать product_access без ожидания ночи.
2. **Не сокращать доступы автоматически.**  
`allow_reduce_access=true` не использовать в этом патче. Если у пользователя доступ длиннее нового source-window — только `skipped_no_change`.
3. **По Валерии отдельно зафиксировать результат.**  
В финальном отчёте показать:
  - source subscription;
  - rule_id;
  - target products;
  - текущие `expires_at`;
  - что именно продлено/пропущено и почему.
4. **Перед execute обязательный гейт:**
  - `failed=0`;
  - `conflict_manual=0`;
  - `conflict_multiple=0`;
  - planned writes ≤ 10 для scoped execute.
5. **После execute:**
  - повторный dry-run;
  - ledger proof;
  - audit proof;
  - cron proof.

Можно продолжать до полного DoD.

&nbsp;

План:

## 1. Проблема

По Валерии видно, что оплата/renewal BUSINESS была обработана, но secondary product_access после оплаты не был корректно доведён в момент webhook-flow. Сейчас часть доступов закрывается ночным reconcile, но это не заменяет требование: после оплаты тарифа BUSINESS выдача/продление/безопасное сокращение должны происходить автоматически и единым правилом, без ручной выдачи.

## 2. Диагностика

Фактически проверено:

- У Валерии профиль: `6972333@mail.ru`, user_id `0d778566-b079-4e62-a5c0-3d9f07ec898e`.
- BUSINESS subscription: `159e70e0-89a0-4b16-8ead-035e93d371b5`, tariff_id `7c748940-dcad-4c7c-a92e-76a2344622d3`.
- Сегодня webhook/order `09018e5b-0af1-4cc2-9554-dfe930e56dab` был обработан, `webhook_events` показывает `outcome=processed`, `parsed_kind=link_order`, `http_status=200`.
- `grant-access-for-order.skip_already_fulfilled` сработал в 11:30 UTC, но audit показал `secondary_sync_outcomes: already_satisfied=3, condition_not_met=8` при старом `subscription_access_end_at=2026-04-30T20:59:59+00:00`.
- После этого сама source subscription была обновлена до `2026-05-30T20:59:59+00:00`, а secondary-доступы были догнаны позже reconcile/ручным запуском.
- Cron `access-rules-nightly-reconcile` уже активен: schedule `0 0 * * *` (00:00 UTC / 03:00 Minsk).
- Но в коде всё ещё есть критичный дефект: `grant-access-for-order/index.ts` содержит старый большой inline-блок `product_access` на строках примерно `1525–1842`, параллельно с helper `syncSecondaryProductAccessForUser`. Это два разных SOT.
- `access-rules-nightly-reconcile/index.ts` в репозитории не пишет audit summary, хотя в БД есть audit от другой/старой версии деплоя. Нужно привести код к обязательной наблюдаемости.
- В helper найден риск для сокращения срока: `allowReduceAccess` уже есть, но cron payload сейчас не передаёт его явно, а UI/ручной сценарий на скриншоте требует контролируемое применение сокращений после preview.

## 3. Предлагаемое решение

### PATCH A — убрать второй SOT в `grant-access-for-order`

1. Полностью удалить/заменить основной inline-блок `product_access` в `grant-access-for-order`.
2. После создания/обновления primary subscription вычислять актуальный source subscription:
  - при `results.subscription.id` — использовать её;
  - иначе перечитать активную/past_due subscription по `user_id + product_id + tariff_id`, сортируя по максимальному `access_end_at`;
  - это устранит баг Валерии: helper должен видеть уже новый `access_end_at`, а не старое значение до webhook-обновления.
3. Вызвать только `syncSecondaryProductAccessForUser`:
  - `sourceEventType='webhook'`;
  - `sourceSubjectType='order'`;
  - `sourceEventKeyPrefix='gafo:product_access:<orderId>'` или совместимый deterministic prefix;
  - `excludeOrderId=orderId`;
  - `allowReduceAccess=false` по умолчанию.
4. Early-return `already_fulfilled` оставить через helper, но source subscription передавать актуальную, перечитанную после возможного webhook update.
5. Старый inline-код не оставлять как активную ветку. Максимум — короткий комментарий-reference, что SOT перенесён в helper.

### PATCH B — корректная автоматизация после webhook renewal

1. В `bepaid-webhook` проверить участок link_order/subscription renewal:
  - если webhook сначала вызывает `grant-access-for-order`, а затем обновляет `subscriptions_v2`, переставить порядок или добавить повторный secondary sync после финального обновления subscription window.
2. Канонично: после того как `subscriptions_v2.access_end_at` уже обновлён до provider truth, вызвать `grant-access-for-order`/helper так, чтобы secondary-доступы получили новый срок сразу.
3. Не добавлять отдельный write-path: все writes product_access остаются через helper.

### PATCH C — reconcile как safety net, не основной поток

1. Оставить cron `0 0 * * *` активным.
2. В `access-rules-nightly-reconcile` добавить обязательный audit summary в `audit_logs`:
  - `dry_run`, `source`, `tariff_ids/product_ids/user_ids`, `max_subscriptions`;
  - counts: `condition_not_met_prior_purchase`, `condition_met`, `missing/granted`, `needs_extension/extended`, `reactivation_candidates/reactivated`, `conflict_manual`, `conflict_multiple`, `failed`;
  - elapsed_ms, processed, evaluated.
3. Поддержать безопасные лимиты batch/limit из payload cron. Если лимита нет — использовать существующий safe default.
4. Для сокращения срока: добавить/проверить явный `allow_reduce_access` в payload и helper, но не включать его в nightly по умолчанию без отдельного админского подтверждения.

### PATCH D — helper correctness

1. Проверить и при необходимости поправить `product-access-grants.ts`:
  - `priorPurchaseCache` используется только когда передан;
  - без cache единичный webhook-flow использует `checkPriorPurchase`;
  - batch prior_purchase SOT остаётся только `orders_v2.status='paid'`, `user_id`, `product_id`, exclude current `order_id`;
  - `writeLedgerEntry` возвращает и пробрасывает `id`, `execution_key`;
  - ledger enums/checks: `source_subject_type='order'|'cron_job'`, `source_event_type='webhook'|'cron'` валидны.
2. Исправить metadata для updated entitlements: `source_access_end_at` должен отражать новый source window, а не старый.

## 4. Изменяемые компоненты

- `supabase/functions/grant-access-for-order/index.ts`
- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/_shared/product-access-grants.ts`
- `supabase/functions/access-rules-nightly-reconcile/index.ts`
- при необходимости `supabase/functions.registry.txt`, если reconcile-функция не включена в деплойный registry.
- Таблицы только читаются/пишутся через существующие механизмы: `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `access_grant_ledger`, `audit_logs`, `cron.job`.

## 5. Что не будет изменено

- Не создаём новые таблицы, enum, статусы или второй ledger.
- Не меняем source of truth: `orders_v2` для покупки, `subscriptions_v2` для recurring window, `entitlements` для видимости, `access_rules` для правил.
- Не делаем ручной массовый UPDATE без dry-run.
- Не используем `entitlements + access_rules` как proof prior_purchase.
- Не меняем правила доступа BUSINESS по названиям/строкам — только UUID.

## 6. Dry-run

После патча, перед execute:

1. `deno check` для изменённых edge functions/shared helpers.
2. Dry-run helper/reconcile по Валерии:
  - `dry_run=true`, `tariff_ids=[BUSINESS]`, `user_ids=[0d778566...]`.
  - Ожидание: после уже догнанного состояния `extended=0`, `failed=0`, `conflict_manual=0`, `conflict_multiple=0`, `already_satisfied=3`, `condition_not_met_prior_purchase=8`.
3. Full BUSINESS dry-run:
  - без timeout;
  - отдельно вывести counts: `condition_not_met_prior_purchase`, `condition_met`, `missing/granted`, `needs_extension/extended`, `reactivation_candidates/reactivated`, `conflicts`, `failed`.
4. Проверить grep-guard: в `grant-access-for-order` не осталось активного inline product_access grant logic.

## 7. Execute

1. Задеплоить изменённые edge functions.
2. Выполнить controlled execute только если dry-run не показывает неожиданные conflicts/failed.
3. Если по BUSINESS есть текущий drift — выполнить controlled execute с STOP-guard:
  - stop если planned writes > 10 для scoped execute;
  - stop если failed/conflicts > 0.
4. Повторный dry-run после execute.
5. Проверить ledger rows по текущему source_event_key_prefix.
6. Проверить cron job:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname ILIKE '%access-rules%';
```

## 8. STOP-guards

Остановиться и не выполнять execute, если:

- `deno check` падает;
- full dry-run BUSINESS уходит в timeout;
- `failed > 0` или `conflict_manual/conflict_multiple > 0` в execute-когорте;
- planned writes для scoped execute > 10 без отдельного подтверждения;
- обнаружится, что `grant-access-for-order` всё ещё содержит активный inline product_access write-path;
- `writeLedgerEntry` не возвращает `id/execution_key` или ledger check constraints не принимают source types;
- webhook обновляет subscription window после secondary sync и нет повторного вызова helper.

## 9. DoD

Задача считается завершённой, когда подтверждено:

1. По Валерии текущие BUSINESS secondary-доступы соответствуют покупке тарифа BUSINESS и source subscription window.
2. Новые BUSINESS renewal payments автоматически доводят secondary product_access сразу после webhook, без ручной выдачи.
3. `grant-access-for-order` больше не содержит отдельный inline product_access grant logic.
4. Early-return и обычный fulfillment используют один helper.
5. `prior_purchase` остаётся SOT только по фактическим paid orders.
6. Dry-run BUSINESS проходит без timeout и показывает раздельные counts.
7. Execute при необходимости проходит с `failed=0`, `conflict_manual=0`, `conflict_multiple=0`.
8. `access_grant_ledger` содержит валидные `source_subject_type`/`source_event_type` и возвращённые `execution_key`.
9. Cron `0 0 * * *` активен, но является safety net, а не единственным способом выдачи после оплаты.
10. Финальный отчёт содержит: webhook-flow/helper proof, dry-run counts, execute counts, ledger proof, cron proof.

## 10. Риски и зависимости

- Сейчас проект в read-only/plan mode, поэтому я не могу внести PATCH и выполнить deploy/execute до утверждения плана.
- В продакшене уже есть движение данных: новые оплаты могут менять counts между dry-run и post-check. Это фиксируем как `new_drift_after_execute`, не как blocker, если failed/conflicts = 0.
- Сокращение сроков должно оставаться отдельным подтверждаемым режимом (`allow_reduce_access=true`) — нельзя включить silent shortening в nightly без отдельного бизнес-решения.

## 11. Требуется дополнительная информация

Дополнительная информация от вас не нужна. После утверждения я продолжу выполнение до полного DoD: патч, dry-run, controlled execute при необходимости, verify и финальный отчёт.