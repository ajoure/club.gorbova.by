# PLAN-ONLY / READ-ONLY (v2, с исправлением): fail-closed guard до пропагации доступа

Ничего не изменено: без кода, deploy, миграций, provider-записей, Publish.

## Подтверждение вашей поправки — порядок в `bepaid-get-subscription-details`

Точная последовательность (файл `supabase/functions/bepaid-get-subscription-details/index.ts`):

```text
строки 433-460   вычисление truthNextCharge / truthAccessEnd
строки 462-480   запись snapshot + state + next_charge_at в provider_subscriptions
строки 486-495   STOP-guard только на «оба truth-поля пустые»
строки 497-580   PATCH 2: пропагация дат в subscriptions_v2
                 (в т.ч. 536-537: авто-восстановление auto_renew=true,
                  если access_end_at в будущем, а статус expired/past_due)
строки 583-660   продление entitlements (expires_at, status='active')
строки 661-760   продление/создание telegram_access_grants (клубный chain)
строки 776-935   ТОЛЬКО ЗДЕСЬ персист last_transaction в payments_v2
```

Ваша поправка верна: доступ и Telegram продлеваются **раньше**, чем функция вообще смотрит на транзакцию. Более того, блок 536-537 может **вернуть `auto_renew=true`** локально отменённой подписке. Гард «только по amount» этого не закрывает. Колонки `canceled_at`, `auto_renew_disabled_at`, `auto_renew`, `status`, `access_end_at` в `subscriptions_v2` существуют.

## Минимальный fail-closed guard (предложение)

Одна вставка, ровно между строкой 484 (после записи `provider_subscriptions` snapshot/state) и строкой 497 (до любой пропагации).

Логика:

1. Если `effectiveSubV2Id` есть — прочитать `status, canceled_at, auto_renew, auto_renew_disabled_at, access_end_at`.
2. Определить локальный «момент отказа»: `localStopAt = min(canceled_at, auto_renew_disabled_at)`, либо, если оба NULL, но `status IN ('canceled','expired','superseded')` — считать отказ существующим без точной метки.
3. Определить `lastTx = sub.last_transaction` с `status='successful'` и его `created_at/paid_at`.
4. **Условие post-cancel charge**: `lastTx` успешен И (`lastTx.paid_at > localStopAt`, либо `localStopAt` неизвестен, а статус терминальный и `truthAccessEnd > access_end_at`).
5. При срабатывании:
   - записать `audit_logs` `bepaid.sync.post_cancel_charge_manual_review` (sub_v2_id, provider_subscription_id, tx uid, paid_at, локальные метки, предлагавшийся `truthAccessEnd`, фактический `access_end_at`);
   - записать в `provider_subscriptions.meta.post_cancel_charge = { detected_at, tx_uid, requires_manual_review: true }`;
   - **полностью пропустить блоки 497-760** (subscriptions_v2, entitlements, telegram) — fail-closed;
   - вернуть в ответе `local_propagation: 'blocked_post_cancel_charge'`;
   - snapshot провайдера при этом уже сохранён, то есть read-only pull остаётся полезным.
6. При неопределённости (`lastTx.status` неизвестен, метки времени отсутствуют и класс не доказан) — тоже блокировать пропагацию и писать `manual_review`; неопределённость трактуется в пользу «не трогать доступ».

Дополнительно, отдельно и минимально: в блоке персиста (строка 847) не вставлять строку при отсутствующей сумме, а писать `audit_logs` `bepaid.payment.upsert_skipped_no_amount` — чтобы pull не падал с `payment_insert_failed`.

Итог по файлу: два узких изменения, без переписывания функции.

## Второй файл — новый материализатор

`supabase/functions/admin-materialize-post-cancel-charge/index.ts` (admin/superadmin, `dry_run=true` по умолчанию), как в предыдущей версии плана: создаёт **только** 1 REBILL order + 1 строку `payments_v2` из уже существующей строки очереди `c312dc07…` (`bepaid_uid = d16b929f…`, 150.00 BYN, `paid_at 2026-08-11 03:00:50+00`, tracking `subv2:603f9077…:order:17181a8c…`), с `manual_review=true`, `refund_candidate=true`, `access_suppressed=true`. Внутри функции запрещены записи в `subscriptions_v2`, `entitlements`, `entitlement_sources`, `telegram_access*` и любые provider POST. Идемпотентность по `provider='bepaid' + provider_payment_id`. Миграции не нужны.

## Тесты и контракты

Юнит-тесты классификатора (чистая функция, без сети):

1. успешная транзакция позже `canceled_at` → `blocked_post_cancel_charge`;
2. успешная транзакция раньше `canceled_at` → пропагация разрешена (регресс на нормальный сценарий);
3. `canceled_at`/`auto_renew_disabled_at` NULL, статус `expired`, `truthAccessEnd` в будущем → блок;
4. активная подписка без отказа → пропагация разрешена, `auto_renew` restore не ломается;
5. `last_transaction` без суммы → payment не вставляется, ошибка не бросается;
6. неопределённые данные → блок (fail-closed).

Контракты dry-run / read-back для EXECUTE:

- Pull по инцидентной подписке `sbs_dcd7…`: `local_propagation='blocked_post_cancel_charge'`, счётчики и md5 `subscriptions_v2` (1471), `entitlements` (1088), `telegram_access` (266) — без изменений.
- Материализатор dry-run: `processed=1`, `would_create_orders=1`, `would_create_payments=1`, `access_actions=0`, ноль DML и ноль provider-запросов.
- Материализатор execute: `orders_v2` 4600 → 4601, `payments_v2` 6585 → 6586 ровно за счёт `d16b929f…`; `subscriptions_v2` / `entitlements` / `telegram_access` — байт в байт прежние; повторный вызов → `already_materialized`.

## Про уже произошедшее продление доступа по инциденту

Рекомендация: **не трогать сейчас.** Клиент фактически оплачен на 150 BYN, оплаченный период у провайдера был `active_to = 2026-09-08`. Сокращение доступа до возврата средств создаёт вторую претензию поверх первой. Правильный порядок: сначала материализовать платёж как `refund_candidate`, затем выполнить возврат отдельным согласованным шагом, и только после подтверждённого возврата — отдельным решением привести `access_end_at` в соответствие. Никакой мутации доступа в этом спринте.

## Порядок продолжения

1. Merge PR из двух файлов → sync exact SHA → deploy ровно `bepaid-get-subscription-details` и `admin-materialize-post-cancel-charge`.
2. Read-only pull по `ea2eea93`, `ef99dcc8`, `74993d13` (гард гарантирует отсутствие продлений) до их ближайших renew-дат.
3. Dry-run → execute материализации инцидента с read-back выше.
4. Возврат 150 BYN и вопрос по `d120f76e` (двойной поток списаний) — отдельными согласованными задачами.
