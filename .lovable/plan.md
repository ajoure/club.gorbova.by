# План: Strict-аудит доступов и Proof-пакет Фаз А/В/Г

## Статус фаз

| Фаза | Статус | Proof-пакет |
|------|--------|-------------|
| А v3 (Strict-аудит) | ✅ Закрыта | batch 20260405_160530_4e1f607b, 7 CSV + 6 proof CSV |
| В (UI predicate) | ✅ Закрыта — UI proof подтверждён | proof_query_joins + proof_no_direct_update + proof_ui_counts_match (browser) + proof_predicate_conditions |
| Г (Bulk extend) | ⚠️ Условно закрыта — code+SQL proof | proof_query_joins + proof_no_direct_update + proof_bulk_extend_cases (code trace) |
| Б (Data fixes) | ❌ Заблокирована | Ждёт dry-run и отдельного согласования |

## Ограничения proof-пакета

- **Runtime execute не выполнялся** — страница сделок недоступна через browser preview (RLS ограничения preview-пользователя)
- **UserSubscriptions UI** — не проверен (preview-user не имеет подписок)
- Для полного закрытия Фазы Г требуется production-admin UI test или curl-вызов grant-access-for-order

## Единый predicate (источник истины)

Файл: `src/hooks/useAccessValidation.ts`

5 условий predicate:
1. `status IN ('active','trial')`
2. `access_end_at` не истёк
3. `product_id` есть в active `access_rules`
4. `products_v2.is_active != false`
5. `tariffs.is_active != false`

## Подключение predicate в 3 компонентах

| Компонент | Файл | Query joins |
|-----------|------|-------------|
| ContactDetailSheet | src/components/admin/ContactDetailSheet.tsx | products_v2(id,name,code,telegram_club_id,is_active), tariffs(id,name,code,...,is_active) |
| UserSubscriptions | src/components/user/UserSubscriptions.tsx | products_v2(id,name,code,is_active), tariffs(id,name,code,is_active) |
| BulkExtendAccessDialog | src/components/admin/BulkExtendAccessDialog.tsx | products_v2(id,name,is_active), tariffs(id,name,is_active) |

## UI proof (Фаза В)

Тестовый пользователь: `6ae5cc6e-81f5-4920-bdf6-805eb700de12` (kate_9292@mail.ru, Кузьменок Екатерина)

| Метрика | SQL predicate | UI (browser) | Расхождение |
|---------|---------------|--------------|-------------|
| badge на вкладке «Доступы» | 4 | 4 | 0 |
| active_list (карточки) | 4 | 4 | 0 |
| toggle «Показать завершённые» | 8 | 8 | 0 |
| tech_active_without_ground | 0 | — | — |

## Расхождение 304 → 10

- Batch v2: 304 = **сделки** (orders_v2) с entitlement без active subscription
- Batch v3: 10 = **подписки** (subscriptions_v2) active/trial, не проходящие predicate
- Это разные сущности, числа напрямую НЕ сравниваются

## Артефакты

Папка: `/mnt/documents/audit_v3_20260405_160530_4e1f607b/`

Основные: 01-07 CSV
Proof (add-only): 08-15 CSV + FINAL_REPORT_v2.md

## Правило по коду

Код не меняется по умолчанию. Если в proof обнаружится расхождение между SQL и UI — оформляется отдельный PATCH с причиной расхождения и новым DoD.

## Фаза Б — заблокирована

Никаких data-fix не выполняется до dry-run и отдельного согласования.
