# План: PLAN-ONLY ревизия PR #297 (merged SHA bc8333df) — VERDICT: CONDITIONAL PASS

Мутаций нет: код, БД, функции, deploy, Publish и реальный возврат не выполнялись.

## 0. Ограничение ревизии (важно)

PR #297 уже MERGED, exact merged SHA — `bc8333df798dffdcbd501af5d5ad5f9246d802f9`
(ранее ошибочно указанный `7adcdecc` не используется).

Этот SHA **не синхронизирован** в managed-воркспейс: в дереве нет
`src/test/refundComposableGroupRecovery.test.ts`, а в
`supabase/functions/subscription-admin-actions/index.ts` нет ни одного упоминания
`settle_composable_order_group`. Прямое чтение диффа через GitHub API также
недоступно (404 — приватный репозиторий).

Поэтому ревизия сделана по: (а) текущему deployed-коду функции, (б) фактическим
определениям RPC в production, (в) реальным данным инцидента. Пункты ниже
подтверждают/отклоняют саму инженерную идею патча. Побайтовая сверка диффа
возможна только после синхронизации `bc8333df`.

## 1. Root cause — ПОДТВЕРЖДЁН (PASS)

- `create_composable_refund_intent` первым делом требует
  `order_groups.status IN ('paid','partially_refunded')`, иначе
  `refundable_order_group_not_found`.
- Факт инцидента: группа `0ce392a6…` имеет `status = pending`, при этом
  `orders_v2` = `paid`, платёж bePaid = `succeeded`, 250 BYN.
- `payment_allocations` для item `4ac3af31…` отсутствует — сработала бы и
  вторая проверка `payment_allocation_not_found`.
- Это ровно рассинхронизация settlement, а не ошибка суммы/доступа/авторизации.

## 2. Recovery через settle → один повтор intent — БЕЗОПАСНО (PASS, с условиями)

`settle_composable_order_group(_primary_order_id, _payment_id)` в production:

- жёсткие guard-и: платёж должен принадлежать primary order, быть `succeeded`,
  совпадать по валюте и **точно** по сумме с `order_groups.total_amount`;
- идемпотентен: `payment_allocations` пишется через
  `ON CONFLICT (payment_id, order_group_item_id) DO UPDATE`, группа переводится
  в `paid`;
- `orders_v2` перезаписывает только строки с `role = 'addon'`; primary-заказ не трогается;
- денег не двигает, провайдера не вызывает.

На данных инцидента все guard-и проходят (250.00 BYN = 250.00 BYN, один item с
`role = primary`). Повторный `create_composable_refund_intent` с тем же
`refund_request_key` идемпотентен по `request_key`.

Обязательные условия для PASS:
1. recovery запускается **только** при точном тексте ошибки
   `refundable_order_group_not_found` (и, опционально, `payment_allocation_not_found`);
2. ровно один повтор, без цикла;
3. `refund_request_key` не перегенерируется между попытками;
4. при повторной ошибке — немедленный выход 400/409 без вызова провайдера;
5. ветка idempotent (HTTP 409, `composable_refund_request_already_exists`)
   сохраняется без изменений.

## 3. bePaid недостижим при неудаче settlement/intent — ПОДТВЕРЖДЁН (PASS)

В текущем коде блок composable (строки ~340–395) расположен **до** любых
provider-веток (Stripe ~411, bePaid далее) и завершает запрос `return`-ом при
ошибке. Пока патч не переносит recovery ниже provider-вызова, деньги не
затрагиваются. Это должно быть проверено построчно при синхронизации SHA.

## 4. keep_subscription / keep_access — БЕЗ ИЗМЕНЕНИЙ (PASS, требует сверки)

`effectiveAccessAction` вычисляется до composable-блока и передаётся в intent
как есть; whitelist RPC (`revoke/reduce/keep/keep_subscription`) в production не
менялся, безопасный дефолт `keep` на месте (`src/lib/refundAccessPolicy.ts`).
Патч не должен добавлять новых значений и не должен менять дефолт.

## 5. Для production нужен только deploy функции — ПОДТВЕРЖДЁН (PASS)

`settle_composable_order_group` уже существует в production с нужной сигнатурой
и правами (`service_role` EXECUTE, contract-тест
`supabase/tests/composable_checkout_catalog_contract.sql`). Миграции и правки
данных не требуются: испорченная строка группы чинится самим вызовом RPC во
время следующего возврата.

## Critical findings

- **CF-1 (блокирующий процесс, не код):** merged SHA `bc8333df` не синхронизирован —
  побайтовая ревизия диффа невозможна до sync.
- **CF-2:** recovery обязан быть однократным и привязанным к конкретному коду
  ошибки; общий `catch` вокруг любой ошибки intent недопустим. Проверяется при сверке.
- **CF-3 (снят патчем, требует сверки):** патч уже пишет audit-события
  `group_recovered` / `group_recovery_failed`, то есть постоянный след при
  recovery появляется. Достаточно подтвердить это построчно и убедиться, что в
  audit не попадают PII, provider UID и токены.
- **CF-4:** первопричина `pending`-группы (почему settlement не отработал при
  оплате) патчем не устраняется — нужен отдельный follow-up по webhook-пути.

## EXECUTE-план (после Approval)

Границы: без миграций, без DML/RPC/data-fix, без создания кода и коммитов, без
site Publish, без реального refund.

1. Синхронизировать managed HEAD ровно на
   `bc8333df798dffdcbd501af5d5ad5f9246d802f9`; подтвердить exact HEAD в отчёте.
2. Побайтово сверить **только два файла** PR #297:
   `supabase/functions/subscription-admin-actions/index.ts` и
   `src/test/refundComposableGroupRecovery.test.ts`. Проверить: триггер recovery
   строго по `refundable_order_group_not_found`, один повтор, неизменный
   `refund_request_key`, composable-блок остаётся до provider-веток, whitelist и
   дефолт access action не изменены, audit `group_recovered` /
   `group_recovery_failed` без чувствительных данных.
3. Прогнать `src/test/refundComposableGroupRecovery.test.ts` и существующие
   refund-тесты; ожидание — все PASS. Изменений в файлы не вносить.
4. Deploy **только** Edge Function `subscription-admin-actions`.
5. Read-back после deploy:
   - подтвердить deployed source/version функции и наличие маркеров
     `settle_composable_order_group`, `group_recovered`, `group_recovery_failed`
     в развёрнутой версии;
   - read-only подтвердить, что исходный refund 250 BYN всё ещё НЕ выполнен:
     группа `0ce392a6…` = `pending`, `payment_allocations` для item пусто,
     composable refund intent отсутствует, refund-строк по заказу
     `1e5890d0…` нет, платёж `succeeded` с `refunded_amount = 0`.
6. Реальный возврат 250 BYN в этот execute НЕ входит — только по отдельному
   явному разрешению.

## STOP — Approval needed

Требуется явное одобрение пользователя для запуска EXECUTE-плана. Дальнейших
действий не выполнялось.
