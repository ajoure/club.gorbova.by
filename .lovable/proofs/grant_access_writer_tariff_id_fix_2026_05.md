# PATCH 2 — writer-fix: persist `meta.tariff_id` в primary entitlement writer

**Дата:** 2026-05-06 (Minsk)
**Файл:** `supabase/functions/grant-access-for-order/index.ts`
**Scope:** только primary entitlement writer (INSERT / UPDATE / idempotent-replay merge). Bonus / rule_engine / retroapply писатели НЕ затронуты — они в других файлах и сознательно не трогаются.

## Изменения

1. **Чтение существующего entitlement** (lines ~786-816): добавлено `meta` в SELECT, тип расширен на `meta: Record<string, unknown> | null`.
2. **UPDATE branch** (existingEntitlement merge):
   - читаем `prevMeta = existingEntitlement.meta || {}`;
   - формируем `mergedMeta = { ...prevMeta, granted_by, granted_at, ...(legacyBackfill ? {legacy_product_id_backfilled:true} : {}) }`;
   - если `tariffId` непустой → `mergedMeta.tariff_id = tariffId`;
   - старый meta НЕ затирается, любые ранее проставленные ключи сохраняются.
3. **INSERT branch** (новый entitlement): в `meta` добавлено `...(tariffId ? { tariff_id: tariffId } : {})`.
4. **Idempotent replay merge** (duplicate-on-product_code): SELECT расширен на `meta`, мерж по той же схеме что в UPDATE — старый meta сохраняется, `tariff_id` пишется при наличии.

## Что НЕ изменилось

- `status / expires_at / product_id / order_id` — без изменений;
- Логика `GREATEST(existing.expires_at, accessEndAt)` — без изменений;
- Никаких изменений в bonus writers (`subscription-grant-telegram`, retroapply, rule_engine);
- `tariffId` берётся из `order.tariff_id` (уже существующая локальная переменная, line 636) — никаких новых fetch'ей.

## Поведение

- order.tariff_id IS NULL → `meta.tariff_id` не пишется, прежнее значение в meta сохраняется (если было).
- order.tariff_id IS NOT NULL → `meta.tariff_id = tariffId` всегда, перезаписывая старое (это OK: новый order canonically привязан к этому тарифу).
- Bonus/rule_engine entitlements не идут через этот writer — их meta остаётся без `tariff_id`, как и положено архитектурно.

## Smoke (manual, после деплоя edge функции)

1. **Новый admin_grant order** на user без entitlement по этому продукту:
   - `INSERT` ветка → `meta.tariff_id = order.tariff_id`. ✅
2. **Повторный admin_grant** того же продукта:
   - `UPDATE` ветка → `meta.tariff_id` обновлён, остальные ключи (`granted_by`, …) сохранены. ✅
3. **Bonus/rule_engine выдача** через retroapply/rule_engine writer:
   - НЕ идёт через `grant-access-for-order` → `meta.tariff_id` не появляется. ✅
4. **GIFT-* order**: тот же путь что admin_grant → `meta.tariff_id` пишется. ✅

## Связанные артефакты

- Backfill `meta.tariff_id` (336 active entitlements): `entitlement_tariff_id_backfill_execute_2026_05.md` — закрыт.
- Этот writer-fix закрывает upstream gap, чтобы новые orders не воссоздавали старую проблему.

## DoD

- [x] INSERT/UPDATE/replay-merge пишут `meta.tariff_id` при наличии `order.tariff_id`.
- [x] Старый `meta` сохраняется (UPDATE и replay-merge).
- [x] Bonus/rule_engine/retroapply не трогаются.
- [x] Никаких изменений снаружи primary writer.
