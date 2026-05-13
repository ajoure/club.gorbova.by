# PATCH: Permanent Detector — Phantom-Parent Entitlements

**Статус:** backlog
**Создан:** 2026-05-13
**Контекст:** INV-PHANTOM-PARENT-V1 закрыт data-fix + CREATE-guard. Нужен read-only invariant, чтобы регрессия не прошла незаметно.

## Цель
Scheduled read-only детектор cross-tree `historical_module_product_ids` в активных entitlements + alert при появлении.

## Invariant
Для каждого active `entitlements` row, где `meta->>'scope_resolution_mode' = 'module_scope_only'`:
- `meta->'historical_module_product_ids'` (array of UUID) ДОЛЖЕН содержать `product_id` entitlement-а ИЛИ его потомка по products tree.
- Иначе → **phantom-parent**.

Дополнительно: для каждого продукта с `access exists` (active entitlement / subscription / order) → training root должен быть виден через `access-resolver.ts` логику. Если access есть, но resolver возвращает default-deny — **resolver-mismatch**.

## Реализация
- **Edge function** `nightly-phantom-parent-detector` (cron 04:00 Minsk, после `nightly-access-reconcile`):
  1. Сканирует `entitlements` (status='active'), считает phantoms по invariant.
  2. Для sample (top 100 paid users) гоняет access-resolver dry-run и сверяет с listed trainings.
  3. Записывает в `system_health_findings` (или аналог):
     - `finding_id='INV-PHANTOM-PARENT-V1-ONGOING'`
     - `severity='critical'` если `remaining_real_phantoms > 0`
     - `severity='warning'` если `resolver_mismatch_count > 0`
     - `snapshot.total_rows`, `snapshot.affected_users[]`, `snapshot.affected_products[]`
  4. Alert через существующий `nightly-system-health` канал (TG/email super_admin).
- **Report:** generate `/mnt/documents/system_health/phantom_parent_<date>.md` с разбивкой по продуктам.

## DoD
- [ ] Cron работает и пишет findings нет-noise.
- [ ] При искусственной инжекции phantom (test) → alert приходит в течение 24h.
- [ ] Report содержит: продукты с access-but-no-visibility, конкретные user_id, snapshot timestamp.
- [ ] Read-only: НЕ удаляет, НЕ изменяет entitlements (только flagged).
- [ ] Memory: добавить ссылку из `mem://architecture/access-control/phantom-parent-entitlement-guard`.
