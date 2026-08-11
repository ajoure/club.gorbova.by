# План: восстановление bePaid provider-привязок (PR #293)

PLAN-ONLY. Ничего не выполнено: код, БД, Auth/RLS, Storage, deploy, миграции, вызовы production-функций, провайдерские API, отмены, возвраты, сообщения и Publish не затронуты.

## 0. Подтверждение источника (PASS)

- Managed HEAD = `59adea09e5caf846588ff42e2bd1ff81835ce12e`, рабочее дерево чистое.
- Верхний коммит: `fix: harden bePaid provider recovery (#293)`; предыдущие — `7444abbb` (#292), `2431cb10` (#291). PR #293 присутствует.
- Scope на этом SHA:
  - `supabase/functions/bepaid-get-subscription-details/` (`index.ts`, `local_propagation_guard.ts`, `local_propagation_guard_test.ts`)
  - `supabase/functions/admin-relink-bepaid-provider-subscription/index.ts`

### Что содержат merged-реализации

`local_propagation_guard.ts` — детерминированный классификатор с решениями:
`blocked_provider_not_active`, `blocked_transaction_not_successful`,
`blocked_post_cancel_charge`, `blocked_ambiguous_terminal_charge`, `allow`
(с причинами `local_subscription_non_terminal`,
`active_provider_paid_coverage_without_local_cancel`,
`successful_transaction_not_after_local_stop`, `no_access_extension`).
Пропагация локальных дат/доступа возможна только при `allow`.

`admin-relink-bepaid-provider-subscription/index.ts` — CAS-перепривязка одной строки:
обязательные `provider_row_id`, `expected_provider_subscription_id`,
`from_subscription_v2_id`, `to_subscription_v2_id`; `dry_run` по умолчанию `true`;
409 при `subscription_tuple_mismatch`, `active_candidate_not_unique`,
`live_provider_stream_not_unique`; ответы `would_relink` / `relinked` /
`already_relinked`, всегда с `protected_access_unchanged: true`.
Функция меняет только `provider_subscriptions.subscription_v2_id`; она не пишет в
`entitlements` и `telegram_access_grants`.

## Общий протокол доказательств

Перед и после каждого шага снимаются детерминированные счётчики и хеши (только не-PII):

- H1 = хеш упорядоченного набора `subscriptions_v2(id, status, auto_renew, access_end_at, canceled_at)` затронутых пользователей
- H2 = хеш `entitlements(id, user_id, product_id, status, expires_at)`
- H3 = хеш `telegram_access_grants(id, user_id, channel, status, expires_at)`

Правило: на шагах 1, 2 (dry-run), 4 и 6 H1/H2/H3 обязаны совпасть побайтно.
На шаге 2 (execute) допускается изменение только `provider_subscriptions.subscription_v2_id`,
H1/H2/H3 неизменны. На шагах 3 и 5 изменения допускаются строго в заранее перечисленных строках.

Исключение навсегда: `d120f76e / sbs_e5a0f624` не участвует ни в одной мутации,
ни в одном батче, ни в перепривязке, ни в отмене (нерешённая коммерческая неоднозначность).

---

## Шаг 1. Deploy ровно двух функций с SHA `59adea09`

- Синхронизировать managed source на exact SHA `59adea09e5caf846588ff42e2bd1ff81835ce12e`, дерево чистое.
- Развернуть только: `bepaid-get-subscription-details`, `admin-relink-bepaid-provider-subscription`.
- Ни миграций, ни других функций, ни UI Publish.
- Read-back маркеров развёрнутого исходника:
  - guard: `blocked_post_cancel_charge`, `blocked_provider_not_active`, `blocked_ambiguous_terminal_charge`, вызов `classifyLocalPropagation(` раньше `bepaid.subscription.sync_dates`;
  - relink: `const dryRun = body.dry_run !== false`, `active_candidate_not_unique`, `live_provider_stream_not_unique`, `subscription_tuple_mismatch`, `protected_access_unchanged`.
- Ожидаемые счётчики: deployed_functions = 2, migrations = 0, publishes = 0.
- STOP: несовпадение SHA, грязное дерево, ошибка бандлинга, отсутствие любого маркера.
- Rollback: повторный deploy тех же двух функций с предыдущего известного SHA `7444abbb`; данные не затрагиваются.

## Шаг 2. Dry-run CAS-перепривязки 15 stale-строк

Префиксы provider-строк (ровно 15):
`10fdba30, 22e76b04, 2f4d6c88, 555ddacf, 5c816d58, 74993d13, 7a3c927d, 81193c75, b61394a7, bfb8ae64, cde3dadc, e03cb205, e1686cc6, ea2eea93, ef99dcc8`.

- Read-only резолв полных ID: для каждого префикса ровно одна строка `provider_subscriptions`; её `provider_subscription_id`, текущий (stale) `subscription_v2_id`, и ровно один активный (`active|trial`) кандидат `subscriptions_v2` с точным совпадением `user_id + product_id + tariff_id`, и ровно один живой провайдерский поток на этот tuple.
- STOP на любом префиксе, дающем 0 или >1 строку, 0 или >1 активного кандидата, >1 живой поток.
- Вызвать `admin-relink-bepaid-provider-subscription` с `dry_run: true` по одному разу на строку, последовательно, батчами по 3 с паузой 5 с.
- Ожидаемые счётчики: вызовов 15, `decision = would_relink` 15, ошибок 0, `protected_access_unchanged = true` 15.
- H1/H2/H3 до и после — без изменений; количество строк `provider_subscriptions` без изменений.
- STOP: любой 409 (`subscription_tuple_mismatch`, `active_candidate_not_unique`, `live_provider_stream_not_unique`), любой ответ ≠ `would_relink`, любое изменение хешей.
- Execute-фаза (только после отдельного одобрения): те же 15 вызовов с `dry_run: false`, ожидание `relinked` 15 (или `already_relinked` при повторе), затем немедленный повтор для доказательства идемпотентности: `already_relinked` 15, новых строк 0.
- Rollback: обратная CAS-перепривязка той же функцией с обменом `from`/`to` для точно перечисленных `provider_row_id`.

## Шаг 3. Guarded read-back и восстановление доступа: `23eb8667, 3a2d45b3, 52105d66, ba966d2b`

- Последовательно, по одному вызову `bepaid-get-subscription-details` на строку (это провайдерское чтение — выполняется только на execute-фазе, не сейчас).
- Условие восстановления доступа: провайдер `active` И оплаченное покрытие текущее на момент выполнения (`renew_at/active_to` > now, последняя транзакция `successful`), И guard вернул `allow`.
- Если guard вернул любое `blocked_*` — доступ не восстанавливается, строка уходит в отчёт как требующая решения человека.
- Ожидаемые счётчики (по предыдущему аудиту): кандидатов 4, ожидаемо `allow` 4; фактическое число подтверждается по факту read-back.
- Изменения допускаются только по этим 4 пользователям и только в сторону продления/восстановления актуального оплаченного доступа; H1/H2/H3 фиксируются построчно до/после каждого вызова.
- STOP: `blocked_provider_not_active`, `blocked_post_cancel_charge`, `blocked_ambiguous_terminal_charge`, изменение хеша у пользователя вне списка из 4, любое изменение сумм/заказов.
- Rollback: восстановление предыдущих значений `status/access_end_at/expires_at` строго по снятым before-снимкам этих 4 пользователей.

## Шаг 4. Доказательство, что `1e194e48` и `df1d3f22` остаются expired/без доступа

- Read-only: провайдер `failed`, покрытие закончилось (01.08 и 15.06 соответственно).
- Один guarded read-back на строку допустим; ожидаемое решение — `blocked_provider_not_active`, пропагация 0.
- Ожидаемые счётчики: строк 2, восстановлений доступа 0, изменений H1/H2/H3 = 0.
- STOP: любое изменение хешей, любой `allow`, любое продление доступа.
- Rollback: не требуется (мутаций нет); при непредвиденной мутации — откат по before-снимку и остановка спринта.

## Шаг 5. Отмена ровно одной живой провайдерской подписки `edc3eef9`

- Preflight (read-only): ровно одна строка по префиксу; связанная локальная `subscriptions_v2` в статусе `canceled` с точной меткой `canceled_at`; отсутствие успешных списаний после отмены; отсутствие другой активной локальной подписки на тот же `user_id + product_id`.
- Отмена выполняется только канонической функцией `subscription-actions` (никаких прямых провайдерских вызовов), ровно один раз.
- Требование: оплаченный доступ до конца оплаченного периода сохраняется; H2/H3 неизменны, в H1 меняется только флаг авто-продления/провайдерского состояния этой строки.
- Ожидаемые счётчики: отмен 1, затронутых пользователей 1, изменений entitlements 0, изменений telegram-грантов 0.
- STOP: >1 строка, отсутствие доказательства локальной отмены, наличие успешного списания после отмены, любой ответ функции без `provider_cancel_confirmed`.
- Rollback: отмена у провайдера необратима — поэтому шаг выполняется последним и только после PASS шагов 1–4; компенсация при ошибке — ручное решение с уведомлением владельца, без автосоздания новой подписки.

## Шаг 6. Финальный re-audit строгого риск-набора

- Повторить запрос: живые провайдерские подписки, связанные с `subscriptions_v2` в статусах `canceled/expired/past_due/superseded`.
- Ожидание: было 23 → после шагов 2/3/5 остаётся `d120f76e` (исключён) плюс строки, которые guard явно оставил на человеческое решение; целевой остаток по механическому ремонту = 0.
- Дополнительно: 0 успешных строк `payment_reconcile_queue` после применимой отметки отмены, отсутствующих в `payments_v2` (кроме уже обработанного UID).
- Финальные H1/H2/H3 сверяются с ожидаемым дельта-набором из шагов 3 и 5; любое расхождение — STOP и отчёт.

## Глобальные STOP-условия

1. Любое несовпадение SHA или грязное дерево.
2. Любая мутация доступа вне явно перечисленных строк шагов 3 и 5.
3. Любой 409/ошибка уникальности при резолве полных ID.
4. Любое касание `d120f76e / sbs_e5a0f624`.
5. Любое изменение платежей, заказов, сумм, ролей, шаблонов или чатов.
6. Любая необходимость править код — спринт останавливается, правка идёт через GitHub PR.

Исполнение не начиналось; жду отдельного EXECUTE по шагам.
