# План: Strict-аудит доступов и Proof-пакет Фаз А/В/Г

## Статус фаз

| Фаза | Статус | Proof-пакет |
|------|--------|-------------|
| А v3 (Strict-аудит) | ✅ Закрыта | batch 20260405_160530_4e1f607b, 7 CSV + 6 proof CSV |
| В (UI predicate) | ✅ Закрыта — UI proof подтверждён | proof_query_joins + proof_no_direct_update + proof_ui_counts_match (browser) + proof_predicate_conditions |
| Г (Bulk extend) | ⚠️ **proof-in-progress** — код обновлён, ждёт browser/runtime proof | PATCH-пакет применён, ждёт 4 сценария browser proof |
| Б (Data fixes) | ❌ Заблокирована | Ждёт dry-run и отдельного согласования |

## Применённые PATCH (2026-04-05)

| PATCH | Статус | Файлы |
|-------|--------|-------|
| PATCH-GLOBAL-CALENDAR-RU | ✅ | `calendar.tsx` — `locale={ru}` default |
| PATCH-BULK-EXTEND-ADMIN-OVERRIDE | ✅ | `useAccessValidation.ts` + `BulkExtendAccessDialog.tsx` |
| PATCH-BULK-EXTEND-DO-NOT-BLOCK-HISTORICAL | ✅ | `checkExtendEligibility` с `isAdminOverride` |
| PATCH-BULK-EXTEND-MODE-DATE-OR-DAYS | ✅ | `BulkExtendAccessDialog.tsx` — radio days/date + DateTimePicker |
| PATCH-BULK-EXTEND-SELECTION-RESET | ✅ | `resetState()` + `useEffect` на open/selection change |
| PATCH-BULK-EXTEND-PREVIEW-SNAPSHOT | ✅ | `snapshotRef` при нажатии preview |
| PATCH-BULK-EXTEND-REASON-CODES-EXPANDED | ✅ | `diagnoseAccessFailure` + reasonCode в preview rows |
| PATCH-BULK-EXTEND-EXECUTE-TARGET-DATE | ✅ | `customAccessEndAt` в edge function + dialog |
| PATCH-NOT-BREAK-CURRENT-PREDICATE | ✅ | `isCurrentValidAccess` без изменений |
| PATCH-PRODUCT-ID-AFFINITY-AUDIT | ✅ | `17_proof_product_affinity_audit.csv` |
| PATCH-ZAKROY-GOD-DIAGNOSIS | ✅ | `16_proof_zakrij_god_diagnosis.csv` |
| PATCH-ACCESS-DURATION-DRIFT-DISCOVERY | ✅ | `18_proof_duration_drift_discovery.csv` — 50+ drift кейсов, backlog |
| PATCH-PROOF-REAL-BROWSER | ⏳ | Ждёт browser proof по 4 сценариям |

## Единый predicate (источник истины)

Файл: `src/hooks/useAccessValidation.ts`

5 условий predicate (БЕЗ ИЗМЕНЕНИЙ):
1. `status IN ('active','trial')`
2. `access_end_at` не истёк
3. `product_id` есть в active `access_rules`
4. `products_v2.is_active != false`
5. `tariffs.is_active != false`

## Admin override (только bulk extend)

- Работает только при `isAdminOverride = true` (admin/super_admin)
- Обходит условия #1 и #2 predicate
- НЕ обходит: отсутствие access rule, деактивированный продукт, неоплаченную сделку
- Preview помечает amber-стилем с reasonCode `admin_override_historical_allowed`
- Execute через `grant-access-for-order` (без прямых update)

## ЗАКРОЙ ГОД — диагноз

- Product `73c29914`: 1 active rule, `is_active = true`
- ВСЕ подписки: `status = expired`, `access_end_at = 2026-04-01`
- Причина блокировки: `subscription_expired` (НЕ отсутствие правила)
- С admin override: продление разрешено

## Duration drift backlog

- 50+ кейсов, максимальный drift: 246 дней (cb20 vs Gorbova Club)
- Требует отдельного PATCH в следующем спринте

## Ожидающий browser proof (Фаза Г)

4 сценария для закрытия:
1. Валидный кейс — применить
2. Кейс нет_активного_правила_доступа — заблокировано
3. Исторический кейс с admin override — amber применить
4. Cancel → смена selection → чистый preview
