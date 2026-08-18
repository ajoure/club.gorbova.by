# PLAN-ONLY REVIEW PR #340 — PASS

Проверка выполнена строго read-only на merged SHA `f983ef86870b26b8438f41f299361ca0bc74b365`. Изменений не вносилось.

## 1. HEAD и чистота дерева — PASS
- managed HEAD = `f983ef86870b26b8438f41f299361ca0bc74b365` (точное совпадение).
- `git status --porcelain` пуст — дерево чистое.

## 2. Область diff — PASS
Коммит `f983ef86` («fix: include controlled CB20 club bonus sources (#340)»), 2 файла / +12 −6:
- `supabase/functions/access-rules-nightly-reconcile/index.ts` (+10 −1)
- `supabase/functions/access-rules-nightly-reconcile/bonus_source_cohort_test.ts` (+8 −5)

Других файлов, миграций, конфигов и frontend-кода нет.

## 3. Фильтр entitlement_sources — PASS
Введена константа `CLUB_BONUS_SOURCE_ORIGINS = ['upsert_club_bonus_entitlement_source', 'controlled_cb20_bonus_backfill_20260810']`, запрос:
`.eq('source_type','bonus')` → `.in('meta->>origin', [...CLUB_BONUS_SOURCE_ORIGINS])` → `.eq('status','active')` → `.gt('expires_at', nowIso)` плюс опциональные фильтры product_ids/tariff_ids/user_ids.
Произвольные и manual-источники исключены: allow-list закрытый, никаких wildcard/`or`. Тест `bonus_source_cohort_test.ts` закрепляет все четыре условия.

## 4. Production counts (read-only, Gorbova Club `11c9f1b8-0355-4753-bd74-40b42aa53616`)
Активные bonus-источники продукта (status=active, expires_at>now):
- `controlled_cb20_bonus_backfill_20260810`: 23 источника, 23 уникальных пользователя, expires_at все = 2026-09-09 21:59:59+00
- `upsert_club_bonus_entitlement_source`: 0
- Итого в когорту войдут 23 источника / 23 пользователя.
- Bonus-источников с иным origin, которые фильтр отсекает: 0 (по всей таблице).

Разрез по тарифу источника:
- `7c748940` (канонический): 15 источников → 2 активных tariff-scoped правила `grant_target_type=product_access`, суммарно 10 target-продуктов → 150 оценок.
- `b276d8a5`: 8 источников → активных product_access правил нет ни на тарифе, ни на product-level → 0 оценок, эти источники пропускаются (`rules.length === 0 → continue`).

Ожидаемые downstream outcomes dry-run (по фактическим данным, без PII):
- evaluations: 150
- condition_not_met (нет paid-заказа на required product): 144
- condition met: 6 (4 уникальных пользователя)
  - без строки entitlement → ожидаемо `granted`: 3
  - есть неактивная строка → ожидаемо `reactivated`: 3
  - `already_satisfied` / `extended`: 0
- Фактическая раскладка granted/reactivated/metadata_backfilled уточняется ответом dry-run; расхождение с этими counts = STOP.

## 5. Отсутствие побочных эффектов — PASS
Патч трогает только выборку когорты в nightly-reconcile. Не изменяются: тарифы и их конфигурация, месячные вебинары, Telegram-гранты/ревокации, платежи и заказы, сделки CRM, а также сами сроки Club bonus (`entitlement_sources.expires_at` не пишется; nightly работает только по downstream product_access и никогда не выполняет destructive-действий).

## 6. EXECUTE plan (после отдельного одобрения)
1. Синхронизировать managed код точно на SHA `f983ef86870b26b8438f41f299361ca0bc74b365` (уже соответствует).
2. Deploy ровно одной функции: `access-rules-nightly-reconcile`. Никаких миграций, никаких других функций, без Publish.
3. Targeted dry-run:
   `POST /functions/v1/access-rules-nightly-reconcile` c телом
   `{"dry_run": true, "product_ids": ["11c9f1b8-0355-4753-bd74-40b42aa53616"]}`
4. STOP и read-back:
   - counts по `entitlement_sources` (23 / 23 пользователя, origin-разрез) до и после — без изменений;
   - `max(updated_at)` и `count(*)` по `entitlements` и `access_grant_ledger` — без изменений;
   - сверка ответа dry-run с ожидаемыми counts из п.4.
5. Любой mismatch, неясный rowcount или новый critical finding → немедленная остановка и отчёт. Никаких data writes на этой стадии.
