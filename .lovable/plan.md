# да, согласен, с учетом правок:

1. **Исправить семантические выборки C и E.** Исторические строки имеют:
  ```sql
  provider = 'admin'
  AND meta->>'source' = 'admin_from_payment'

  ```
  либо:
  ```sql
  provider = 'admin'
  AND meta->>'source' = 'admin_grant'

  ```
  Не искать `provider='admin_from_payment'` или `provider='admin_grant'`.
2. **Для C запретить доказательство duplicate только по** `amount/currency/paid_at ±1 сутки`**.** Canonical bePaid-платёж должен иметь детерминированную связь:
  - тот же `meta.queue_payment_id`;
  - либо точное совпадение provider external ID / tracking ID / bePaid UID через queue;
  - плюс amount, currency и successful status.
  Если точной идентичности нет — строка автоматически уходит в HOLD, даже если сумма и дата совпадают.
3. **PREVIEW должен сформировать неизменяемый manifest**, который затем встраивается в миграцию через `VALUES`/временную таблицу:
  ```text
  legacy_payment_id
  expected_provider
  expected_source
  expected_queue_id
  canonical_payment_id
  expected_amount
  expected_currency
  expected_is_deleted
  cleanup_class

  ```
  Конструкции `$A_payments`, `$canonical_id` в обычной SQL-миграции использовать нельзя.
4. **Для каждого набора зафиксировать три checksum:**
  - checksum текущего состояния;
  - checksum approved candidate manifest;
  - ожидаемый checksum после миграции.
  Фактический post-checksum рассчитывается после UPDATE и должен совпасть с ожидаемым.
5. **Непосредственно внутри транзакции повторить discovery с блокировкой строк:**
  ```sql
  SELECT ... FROM public.payments_v2
  WHERE id IN (...)
  FOR UPDATE;

  ```
  Затем сверить provider/source/queue/amount/currency/is_deleted/count/checksum. Любой drift — полный rollback.
6. Все merge операций с metadata выполнять только так:
  ```sql
  meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(...)

  ```
7. **Не менять subscriptions на несуществующий или новый статус** `archived`**.** Поскольку связанные записи уже `canceled`/`superseded`, оставить статус без изменений и добавить только metadata-маркер cleanup. Изменение статуса допустимо лишь после подтверждения, что `archived` входит в действующий enum/check constraint и поддерживается всеми readers.
8. **Перед soft-archive** `orders_v2` **подтвердить:**
  - колонка `orders_v2.is_deleted` существует;
  - все основные readers исключают такие заказы;
  - soft-delete заказа не ломает документы, связи и финансовые RPC.
  Если это не доказано — заказ не архивировать, добавить только `meta.stage6_cleanup='admin_test_fixture'`.
9. **Документы СА-26-00025 и СА-26-00026:**
  - сначала установить точную таблицу и допустимые статусы;
  - `status='void'` применять только если такой статус уже канонически поддерживается;
  - иначе сохранить текущий статус и добавить `void_reason`/cleanup-marker в metadata;
  - sequence и номер документа не изменять.
10. **E — admin_grant:**
  - включать только строки `provider='admin'`, `source/origin='admin_grant'`, `amount=0`;
  - доказать отсутствие активных readers не только в frontend, но и в SQL-функциях, views, triggers, cron и edge-functions;
  - если хотя бы один runtime consumer зависит от строки — весь E исключается из миграции и остаётся backlog, без блокировки A/B/C.
11. **HOLD D:** запись в `audit_logs` является DML, но в этом плане она заявлена явно и разрешена. В payload сохранить UUID, checksum manifest и точную причину. Сам `payments_v2` не менять.
12. Пост-инварианты не должны использовать заранее предполагаемые `~104` и `9`. Использовать только точные approved counts из PREVIEW:
  ```text
  archived_C = approved_C_count
  hold_D     = approved_D_count

  ```
  Если фактическая классификация отличается — migration не стартует.
13. `Δ выручки = 0` проверить:
  - глобально;
  - по затронутым order_id;
  - до и после `compute_order_financial_state`;
  - отдельно по валютам.
  Простого сравнения одной общей суммы недостаточно.
14. **Физическое удаление edge-функции выполнять только после успешного COMMIT и VERIFY.** Если удаление не удалось, SQL-cleanup не откатывать, но финальный статус функции указать `DEFERRED`, а не `REMOVED`. Проверять отсутствие функции через deploy inventory/API; HTTP может вернуть `401`, а не `404`, из-за платформенного JWT-wall.
15. **Финальный backlog не фиксировать заранее как “ровно HOLD-9”.** Он должен содержать фактический остаток:
  - HOLD без точного canonical lineage;
  - E, если безопасность admin_grant не доказана;
  - документы/orders/subscriptions, если их schema/consumer-проверки не позволяют безопасную архивацию.
16. Разрешение даётся **одним approve сразу на PREVIEW и conditional EXECUTE**:
  - подтверждённые A/B/C/E выполняются одной транзакцией;
  - неподтверждённые классы автоматически исключаются и уходят в итоговый backlog;
  - никаких дополнительных согласований не требуется, если manifest, counts и checksums полностью совпали;
  - при drift или неоднозначности — fail-closed без частичного DML.

После этих уточнений можно выполнять единый cleanup-патч и окончательно закрывать все доказанные legacy-наборы за один проход.

&nbsp;

План: единый cleanup-патч legacy payments_v2 (Stage 6 closeout, консолидированный)

Один approve, одна транзакционная миграция, один отчёт. Никакого физического DELETE финансовых/audit-данных — только soft-archive через `is_deleted=true` + `meta.stage6_cleanup_*`. Сомнительные строки уходят в HOLD, а не угадываются.

## Порядок (жёсткий)

`Diagnose → Plan (этот документ) → Dry run (PREVIEW) → Execute (guarded) → Verify → Close`.

## Шаг 1. PREVIEW (read-only, без DML)

Формирует фиксированный набор ID и checksums, сохраняется в `.lovable/discovery/stage6_cleanup_preview.md` + CSV в `/mnt/documents/stage6_cleanup/`.

Наборы:

1. **A. admin_test fixtures** — ровно 8 строк `payments_v2 provider='admin_test'`, детерминированные признаки: `origin='bepaid'`, `meta.test_payment=true`, пустой `provider_payment_id`. Связанные: до 7 `orders_v2 order_number LIKE 'ORD-TEST-%'`, до 4 `subscriptions_v2`, документы `СА-26-00025` и `СА-26-00026`, до 5 `access_grant_ledger`.
2. **B. bank_transfer Stage 4 R1 fixtures** — ровно 2 строки на order `s4r1_dedupe_3ce8d9a9`, `status='canceled'`, `profile=NULL`.
3. **C. admin_from_payment DUPLICATE** — подмножество из 113 строк, для которых доказано:
  - `meta->>'queue_payment_id'` заполнен и указывает на существующую запись в `payment_reconcile_queue` (или архиве);
  - для этой queue-записи существует canonical `payments_v2 provider='bepaid'` с совпадающими `amount`, `currency`, `paid_at (±1 сут)`, `status='succeeded'`;
  - lineage подтверждён через `meta.source='queue'` / `derived_provider='bepaid'`.
   Ожидаемое количество: ~104. Точное число фиксируется в PREVIEW.
4. **D. admin_from_payment HOLD** — оставшиеся ~9 строк без queue-lineage. НЕ трогаются, только фиксируются в отчёт с `reason='no_queue_link'`.
5. **E. admin_grant** — 201 строка `provider='admin_grant'`, `amount=0`. Перед включением в патч PREVIEW доказывает, что ни один активный reader выдачи доступа (entitlements/subscriptions/access_grant_ledger/edge-functions) не читает эти строки как источник — они лишь audit-marker. Иначе E исключается из этого патча и уходит в отдельный backlog-пункт.

Выход PREVIEW: явные списки UUID, суммы, sha256 CSV, ожидаемые counts до/после. Без совпадения counts миграция не запускается.

## Шаг 2. EXECUTE — одна миграция, один BEGIN

Структура миграции (SECURITY INVOKER, `search_path=public,pg_temp`):

```
BEGIN;

-- 0. Фиксация ожидаемых count'ов в temp table, fail-closed сверка.
--    ЛЮБОЕ несовпадение → RAISE EXCEPTION → ROLLBACK.

-- 1. Soft-archive A (admin_test + ORD-TEST-*):
--    UPDATE payments_v2  SET is_deleted=true, meta = meta || jsonb_build_object(
--        'stage6_cleanup','admin_test_fixture',
--        'stage6_cleanup_at', now())
--    WHERE id = ANY($A_payments);
--    UPDATE orders_v2    SET is_deleted=true, meta || {...'admin_test_fixture'} WHERE id = ANY($A_orders);
--    UPDATE subscriptions_v2 SET status='archived', meta || {...'admin_test_fixture'}
--       WHERE id = ANY($A_subs) AND status IN ('canceled','superseded','expired');
--    access_grant_ledger — НЕ трогаем (audit trail).
--    ai_generated_documents для СА-26-00025 / СА-26-00026:
--        UPDATE ... SET status='void', meta || {'stage6_cleanup':'test_document_void',
--                                                'void_reason':'admin_test_fixture'}.
--    Номера НЕ переиспользуются, sequence не откатывается.

-- 2. Soft-archive B (bank_transfer S4R1 fixtures): аналогично A с меткой
--    'stage4_r1_dedupe_fixture'.

-- 3. Soft-archive C (admin_from_payment DUPLICATE):
--    Для каждой строки перед UPDATE — inline assert:
--       queue_id совпадает с queue-записью,
--       canonical bepaid payment существует, amount/currency/status совпадают.
--    UPDATE payments_v2 SET is_deleted=true,
--       meta || {'stage6_cleanup':'admin_from_payment_duplicate',
--                'canonical_bepaid_payment_id': $canonical_id,
--                'queue_payment_id_verified': $queue_id }.
--    Исходная queue-строка и canonical bepaid — не трогаем.

-- 4. Soft-archive E (admin_grant, если PREVIEW доказал безопасность):
--    UPDATE payments_v2 SET is_deleted=true,
--       meta || {'stage6_cleanup':'admin_grant_archive'}
--    WHERE id = ANY($E_payments) AND amount = 0 AND provider='admin_grant';
--    entitlements / subscriptions / access_grant_ledger — не трогаем.

-- 5. HOLD D: только запись в audit_logs с payload = список 9 UUID и
--    reason='no_queue_link_stage6_hold'. Никаких изменений в самих payments_v2.

-- 6. Пост-инварианты (fail-closed):
--    active_admin_test        = 0
--    active_bank_transfer     = 0
--    active_admin_from_payment_with_queue = 0
--    active_admin_grant       = 0 (если E включён)
--    active_admin_from_payment_no_queue = 9 (HOLD)
--    Δ канонической выручки (compute_order_financial_state) = 0
--    Δ активных entitlements = 0
--    Δ активных subscriptions (не архивных fixture) = 0
--    Stage 6.G триггер по-прежнему активен, whitelist не тронут.

COMMIT;
```

Физически удаляется только edge-функция `test-payment-complete` (отдельный вызов, вне SQL-транзакции, после успешного COMMIT). audit-комментарии в UI (`isTestPaymentLoading` и т.п.) — удаляются в том же патче в `src/`.

## Шаг 3. VERIFY

Скрипт `.lovable/discovery/stage6_cleanup_verify.sql` (read-only) сверяет:

- counts по каждому набору до/после;
- суммы выручки не изменились;
- ни один активный reader выдачи доступа не потерял источник;
- `payment_reconcile_queue`, `access_grant_ledger`, `entitlements` — без изменений;
- документы СА-26-00025 / СА-26-00026 существуют, `status='void'`, номера в `document_number_sequences` не сдвинуты;
- edge-функция `test-payment-complete` возвращает 404 (physically removed).

## Шаг 4. CLOSE

Единый отчёт `.lovable/discovery/stage6_cleanup_final.md`:

```
STAGE 6 CLEANUP PATCH : PASS
  A admin_test soft-archive       : 8 payments, N orders, K subs, 2 docs void
  B bank_transfer S4R1 archive    : 2 payments
  C admin_from_payment duplicate  : ~104 payments soft-archived
  D admin_from_payment HOLD       : 9 payments (no_queue_link)
  E admin_grant archive           : 201 payments (или DEFERRED, если PREVIEW не доказал)
  test-payment-complete           : REMOVED
  UI audit comments               : REMOVED
SPRINT                            : FULLY CLOSED (кроме HOLD-9)
```

Backlog после патча: только 9 строк `admin_from_payment` в HOLD, до появления внешнего источника (bePaid statement / bank recon). Никаких других открытых пунктов.

## Явные запреты в этом патче

- никакого физического DELETE в `payments_v2`, `orders_v2`, `subscriptions_v2`, `access_grant_ledger`, `entitlements`, `ai_generated_documents`;
- никакого сдвига `document_number_sequences` / переиспользования СА-26-00025/00026;
- никаких изменений canonical bePaid платежей и queue-записей;
- никаких изменений Stage 6.G триггера и whitelist;
- никакого автоматического удаления HOLD-9;
- никаких изменений RLS/GRANT в этом патче.

## Технические детали (для разработчика)

- Миграция: `supabase/migrations/<ts>_stage6_cleanup_consolidated.sql`, обёрнута в `DO $$ ... $$` с явными `RAISE EXCEPTION` при любом рассогласовании count/lineage.
- Все UPDATE используют `WHERE id = ANY($list) AND <детерминированный признак>` — двойная защита от промаха.
- `meta` мержится через `||`, старые ключи сохраняются, добавляются `stage6_cleanup*`.
- Edge-функция `test-payment-complete` удаляется через `supabase--delete_edge_functions` после COMMIT.
- UI-чистка: точечные правки в `src/components/payment/PaymentDialog.tsx`, `src/pages/admin/AdminOrdersV2.tsx` (удалить оставшиеся audit-комментарии и `isTestPaymentLoading`). Логика не меняется.
- Все отчёты и коммиты — на русском.

## Definition of Done

1. PREVIEW сохранён, CSV + sha256 зафиксированы.
2. Миграция прошла с COMMIT, все пост-инварианты выполнены.
3. `test-payment-complete` физически удалён, GET/POST → 404.
4. UI-остатки удалены, typecheck/build зелёный.
5. Финальный отчёт создан, backlog содержит ровно один пункт: HOLD-9.
6. Δ выручки = 0, Δ активных доступов = 0, Δ документов (кроме 2 void) = 0.