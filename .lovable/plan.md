# План: Strict-аудит доступов и Proof-пакет Фаз А/В/Г

## Статус фаз

| Фаза | Статус | Proof-пакет |
|------|--------|-------------|
| А v3 (Strict-аудит) | ✅ Закрыта | batch 20260405_160530_4e1f607b, 7 CSV + 6 proof CSV |
| В (UI predicate) | ✅ Закрыта | proof_query_joins + proof_no_direct_update + proof_ui_counts_match + proof_predicate_conditions |
| Г (Bulk extend) | ✅ Закрыта | proof_query_joins + proof_no_direct_update + proof_runtime_preview_execute + proof_ui_counts_match |
| Б (Data fixes) | ❌ Заблокирована | Ждёт dry-run и отдельного согласования |

## Единый predicate (источник истины)

Файл: `src/hooks/useAccessValidation.ts`

Функции:
- `isCurrentValidAccess(sub, productsWithRules)` — 5 условий
- `isHistoricalAccess(sub, productsWithRules)` — инверсия
- `checkExtendEligibility(order, activeSub, productsWithRules, newEnd)` — для bulk extend

5 условий predicate:
1. `status IN ('active','trial')`
2. `access_end_at` не истёк
3. `product_id` есть в active `access_rules`
4. `products_v2.is_active != false`
5. `tariffs.is_active != false`

## Подключение predicate в 3 компонентах

| Компонент | Файл | Import | Query joins |
|-----------|------|--------|-------------|
| ContactDetailSheet | строка 12, 1408-1413 | isCurrentValidAccess, isHistoricalAccess | products_v2(id,name,code,telegram_club_id,is_active), tariffs(id,name,code,...,is_active) |
| UserSubscriptions | строка 14, 103-109 | isCurrentValidAccess, isHistoricalAccess | products_v2(id,name,code,is_active), tariffs(id,name,code,is_active) |
| BulkExtendAccessDialog | строка 4, 120-125 | checkExtendEligibility, isCurrentValidAccess | products_v2(id,name,is_active), tariffs(id,name,is_active) |

## Counts (SQL proof)

- Текущие валидные доступы: **322** (170 уникальных users)
- Технически active/trial без основания: **10** (9 нет_активного_rule + 1 expired)
- Исторические: **540**
- Всего: **862**

## Расхождение 304 → 10

- Batch v2: 304 = **сделки** (orders_v2) с entitlement без active subscription
- Batch v3: 10 = **подписки** (subscriptions_v2) active/trial, не проходящие predicate
- Это разные сущности, числа напрямую НЕ сравниваются
- При пересчёте v2 логики сегодня: 172 (data fixes между батчами)

## Execute flow (Фаза Г)

- Preview: `checkExtendEligibility` (строка 120) — единый predicate
- Execute: `applicable = previewRows.filter(r => r.action === "применить")` (строка 150)
- Вызов: `supabase.functions.invoke("grant-access-for-order")` (строка 162)
- Прямой update `subscriptions_v2` / `entitlements` — **отсутствует** (grep: 0 совпадений)

## Артефакты

Папка: `/mnt/documents/audit_v3_20260405_160530_4e1f607b/`

Основные: 01-07 CSV
Proof (add-only): 08-13 CSV + FINAL_REPORT.md

## Фаза Б — заблокирована

Никаких data-fix не выполняется до:
- dry-run с отдельным batch_id
- отдельного согласования каждого подпатча
