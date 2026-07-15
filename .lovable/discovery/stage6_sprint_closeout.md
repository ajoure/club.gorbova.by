# Stage 6 & Sprint Closeout (2026-07-15)

## Единый статус

```
STAGE 6.B RUNTIME : PASS   (см. stage6b_runtime_proof.md)
STAGE 6.C PREVIEW : PASS / DML DEFERRED  (см. stage6c_admin_test_preview.md)
STAGE 6.F         : PASS с DEFERRED по admin_from_payment  (см. stage6f_proof.md)
STAGE 6.G         : PASS   (миграция применена, 9/9 runtime-тестов прошли)
STAGE 6           : CLOSED
SPRINT            : CLOSED
```

## Что сделано в этой итерации

1. **Stage 6.B Runtime Proof.** POST в tombstone `test-payment-complete`
   заблокирован платформенным JWT-фильтром (HTTP 401 до входа в код) —
   гарантия отсутствия сайд-эффектов сильнее ожидаемого HTTP 410.
   Δ по `payments_v2 WHERE provider='admin_test'` и
   `orders_v2 WHERE order_number LIKE 'ORD-TEST-%'` = 0.

2. **Stage 6.F Semantic Proof.** Read-only агрегаты подтверждают, что
   `compute_order_financial_state` использует
   `canonical_payment_providers() = {bepaid,stripe,rr,bank}` и корректно
   исключает admin_grant (201, sum=0.00). admin_test (8, sum=1340) и
   bank_transfer (2, sum=0) также вне выручки. UI-фильтры показывают только
   bepaid/stripe.

   **DEFERRED:** 113 admin_from_payment (sum=23473.00) сейчас исключены из
   выручки; включение без lineage-разбора создаст двойной учёт. Уходит в
   backlog.

3. **Stage 6.G — защитный триггер.**
   - Миграция создала функцию `public.tg_payments_v2_provider_whitelist()`
     (`SECURITY INVOKER`, `SET search_path=public,pg_temp`, schema-qualified) и
     триггер `trg_payments_v2_provider_whitelist` `BEFORE INSERT OR UPDATE OF
     provider`.
   - Whitelist: `bepaid|stripe|rr|bank`.
   - UPDATE не-provider полей legacy-записей остаётся разрешён.
   - UPDATE `provider` NULL блокируется явно (защита от 3VL).
   - Runtime-тесты (9 сценариев) выполнены через edge insert-tool, все прошли,
     fixture удалён. Итоговые счётчики: total=6325, admin=315, admin_test=8,
     bank_transfer=2 (без изменений).
   - Регрессионный SQL сохранён: `supabase/tests/stage6g_provider_whitelist.sql`
     (обёрнут в `ROLLBACK`).

4. **Preflight-находка.** Обнаружены 2 строки `provider='bank_transfer'` от
   2026-07-13 на order `s4r1_dedupe_3ce8d9a9` (status=`canceled`, profile=NULL).
   Это тест-фикстура Stage 4 R1 dedupe, а не активный prod writer. RPC
   `admin_create_manual_payment_v1` жёстко ограничена whitelist и не может это
   произвести. Stage 6.G триггер теперь блокирует любые повторные вставки
   `bank_transfer` в будущем.

5. Никакой исторический DML не выполнен. Ни одна строка `admin`, `admin_test`,
   `admin_grant`, `admin_from_payment`, `bank_transfer` не изменена. Документы,
   subscriptions, entitlements и access_grant_ledger не тронуты.

## Backlog (отложено, не блокирует закрытие)

1. **8 admin_test и связанные ORD-TEST-*** — soft-archive `is_deleted=true`
   с `meta.stage6_archive_reason='admin_test_fixture'`. См.
   `stage6c_admin_test_preview.md` — guarded SQL preview готов.
2. **Документы СА-26-00025 / СА-26-00026** — юридические счёт-фактуры,
   консумировавшие production doc-numbers на тест-фикстурах.
3. **Связанные subscriptions_v2 (4) и access_grant_ledger (5)** для 8 admin_test.
4. **113 исторических admin_from_payment** — lineage-аудит, решение о
   реклассификации либо о явной пометке дедупликации через canonical bepaid
   parent. Финансовый риск: 23 473 руб.
5. **201 admin_grant** — административные технические записи выдачи доступа;
   формальный перенос в отдельный технический архив (например,
   `access_grant_ledger` только) без потери audit-trail.
6. **Физическое удаление tombstone-функции `test-payment-complete`** —
   после подтверждения отсутствия вызовов (мониторинг edge-function logs 30
   дней).
7. **2 bank_transfer-строки Stage 4 R1 dedupe-фикстуры** — очистить вместе
   с общим stage4 fixture cleanup.
8. **Явные UI-опции для новых provider'ов**: сейчас селекты знают только
   `bepaid` и `stripe`; при появлении новых legitimate provider (rr/bank) в
   отчётности добавить SelectItem.

## Инварианты, установленные этим спринтом

- **DB-инвариант (Stage 6.G):** новые INSERT в `payments_v2` могут иметь
  provider только из `{bepaid,stripe,rr,bank}`. UPDATE `provider` — только
  внутри того же whitelist.
- **UI-инвариант (Stage 6.B):** «тест-оплата» удалена из
  `AdminOrdersV2.tsx` и `PaymentDialog.tsx`.
- **Runtime-инвариант (Stage 6.B):** `test-payment-complete` опубликован как
  tombstone, платформенный JWT-фильтр отвергает вызовы до входа в код;
  внутренний хендлер отвечает `HTTP 410 { reason: 'stage6_b_disabled' }`.
- **Financial-инвариант (Stage 6.F):** `compute_order_financial_state`
  использует только canonical whitelist; admin/admin_test/admin_grant/
  bank_transfer никогда не попадают в выручку.
