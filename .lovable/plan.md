# План: Strict-аудит доступов и Proof-пакет Фаз А/В/Г

## Статус фаз

| Фаза | Статус | Proof-пакет |
|------|--------|-------------|
| А v3 (Strict-аудит) | ✅ Закрыта | batch 20260405_160530_4e1f607b, 7 CSV + 6 proof CSV |
| В (UI predicate) | ✅ Закрыта — UI proof подтверждён | proof_query_joins + proof_no_direct_update + proof_ui_counts_match (browser) + proof_predicate_conditions |
| Г (Bulk extend) | ⚠️ **proof-in-progress** — код + scroll fix применены, RLS blocker на browser proof | PATCH-пакет применён, CSVs 19-20 сгенерированы |
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
| PATCH-BULK-EXTEND-MODAL-SCROLL | ✅ | `BulkExtendAccessDialog.tsx` — `overflow-hidden` + `min-h-0` + `flex-1` scroll |
| PATCH-PROOF-REAL-BROWSER | ⏳ **BLOCKER** | RLS блокирует доступ к orders_v2 в browser session |

## Browser proof blocker

**Причина:** Текущая сессия браузера (Сергей Федорчук / Администратор) не имеет RLS-доступа к таблице `orders_v2`. Страница `/admin/deals` показывает "Найдено: 0".

**Данные в БД:** 2712 записей в `orders_v2` (подтверждено через service role).

**Для разблокировки:** Пользователь должен войти в preview под аккаунтом, у которого есть RLS-доступ к orders_v2, после чего 5 browser-proof сценариев можно выполнить.

## Proof-артефакты (add-only)

| Артефакт | Статус | Описание |
|----------|--------|----------|
| `19_proof_product_access_reconciliation.csv` | ✅ | 8808 строк, 5 продуктов, колонки: product_id/name, order/sub/entitlement/rule IDs, has_active_rule, subscription_status, access_end_at, diagnosis_reason_code, match_status |
| `20_proof_drift_backlog.csv` | ✅ | 200 строк, parent/child drift cases, drift_days, fix_strategy |

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

## Duration drift backlog → PATCH-ACCESS-DURATION-ALIGNMENT

- 200 drift кейсов зафиксировано
- Требует отдельного PATCH в следующем спринте
- Не чинить без отдельного подтверждения

## Ожидающий browser proof (Фаза Г) — 5 сценариев

1. Валидный кейс — применить
2. Кейс нет_активного_правила_доступа — заблокировано
3. Исторический кейс с admin override — amber применить
4. Cancel → смена selection → чистый preview
5. Вертикальный скролл в preview-модалке на 20+ строках + scroll reset после reopen

## Расширенный DoD

| Пункт | Критерий |
|-------|----------|
| Browser proof сценарий 1 | Screenshot зелёной строки «применить» |
| Browser proof сценарий 2 | Screenshot красной строки с `нет_правила_доступа_в_системе` |
| Browser proof сценарий 3 | Screenshot amber строки с `admin_override_historical_allowed` |
| Browser proof сценарий 4 | Screenshot чистого preview после cancel+reselect |
| Browser proof сценарий 5 | Screenshot работающего вертикального scroll внутри preview-модалки |
| Scroll reset proof | После Cancel + reopen список начинается сверху |
| Datetime proof | preview datetime = DB datetime (до минуты) |
| Reconciliation | CSV по 5 продуктам с match_status + diagnosis_reason_code |
| Drift backlog | CSV с drift_days и fix_strategy |
