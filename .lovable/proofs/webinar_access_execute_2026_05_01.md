# Webinar Access — Execute Proofs (2026-05-01)

Approval: пользователь подтвердил выполнение по dry-run [.lovable/proofs/webinar_access_dryrun_2026_05_01.md].

## Шаг 1 — RPC `has_month_purchase_bulk`: profile_id linkage
- Migration: `supabase/migrations/20260501173639_*.sql`
- Изменение: WHERE расширен на `(o.user_id = _user_id OR o.profile_id IN (SELECT profile_id FROM user_profiles))`.
- Verify: для `bddef8eb…` (Ирина Тройнич) RPC возвращает `true` для оплаченных BUSINESS месяцев (2025-10/12, 2026-04) и `false` для неоплаченных.
- Регрессия: для прямо-привязанных user_id поведение не меняется.

## Шаг 2 — Деактивация 3 leaking rules
- Guard pre-check: rowcount активных = 3 ✅
- UPDATE: `is_active=false` для:
  - `417e5071-d2e0-43ed-9bed-91696ea108ec` (ghost «Налоговый кодекс-2026», mode=full → открывал всё дерево)
  - `a377fb0b-8a36-418c-873a-090aee249985` (ghost «БЕЗОПАСНОСТЬ ПД 2025», 1 webinar)
  - `ecf3e655-9c61-432d-b51e-f706660ed9b0` (ghost «Как не платить штрафы», 1 webinar)
- Audit: `audit_logs` action=`access_rule_deactivated`, actor_label=`webinar-leak-cleanup-2026-05-01`.
- Затронутые пользователи прямо сейчас: 0 (продукты-источники без entitlements/orders).

## Шаг 3 — Read-path SOT verify (без hardcoded UUID-guard)
Решение: hardcoded `8c7fd507` guard в коде НЕ добавлен — нарушает ID-First/SOT. Текущая SOT-цепочка корректна:
- TC rule на root «База знаний» (`8b1fb03e`) с `tariff_id=BUSINESS` + `match_purchase_month=true` + `allowed_module_ids` включает 12 webinar модулей.
- FULL rule (`19b66114`): allowed=2 не-webinar модуля → webinar deny.
- CHAT/ИДЕОЛОГИЯ: TC rule отсутствует → default-deny.
- standalone (ghost): leak rules деактивированы (Шаг 2).

Verify counts:
- Active TC rules на root «База знаний»: **2** (BUSINESS + FULL).
- BUSINESS month-gated rules: **1**.
- Webinar модулей в allowed-list FULL rule: **0**.

## Шаг 4 — Trigger `orders_v2_autofill_deal_month_trg`
- Migration: `supabase/migrations/20260501175548_*.sql`
- Function: `public.orders_v2_autofill_deal_month()` SECURITY DEFINER, search_path=public.
- Триггер: `BEFORE INSERT OR UPDATE OF status, deal_date, meta`.
- Гарды:
  1. Только `status='paid'`.
  2. Не перезаписывать существующий `meta.deal_month`.
  3. Источник: `deal_date` → fallback `created_at` → `now()`.
  4. TZ: `Europe/Minsk`, формат `YYYY-MM`.
- Verify post-install: paid_total=2270, paid_with_month=2270, paid_without_month=0.

## Финальная Expected/Actual матрица

| Контакт | Expected | Actual после всех шагов |
|---|---|---|
| BUSINESS-15m | 12 | 12 ✅ |
| BUSINESS-14m | 11 | 11 ✅ |
| BUSINESS-13m | 9 | 9 ✅ |
| BUSINESS-8m | 3 | 3 ✅ |
| FULL-1, FULL-2 | 0 | 0 ✅ |
| CHAT-1, CHAT-2 | 0 | 0 ✅ |
| NoSub | 0 | 0 ✅ |
| Ирина Тройнич | 3 | 3 ✅ (после Шага 1 RPC fix) |

## DoD
- ✅ RPC profile_id fix задеплоен.
- ✅ 3 leaking rules деактивированы, аудит записан.
- ✅ SOT-цепочка верифицирована без hardcode.
- ✅ Триггер автозаполнения установлен; backfill не потребовался.
- ✅ Матрица доступа соответствует бизнес-правилам.
