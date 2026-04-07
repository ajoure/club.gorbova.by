# План: 4 патча — cb20 repair, Деньги BY closure, LibraryModule access filter, Universal RetroApply Engine

---

## Архитектурная норма

**RetroApply — это универсальный ручной механизм применения новых или изменённых access_rules к историческим данным по всем продуктам и тарифам, а не специальная логика только для BUSINESS.**

- Engine НЕ привязан к BUSINESS, НЕ привязан к club, НЕ привязан к Деньги BY
- Rule выбирается параметрами запуска (rule_ids / source_product_id / source_tariff_id / changed_since)
- Два режима: **grant missing access** (default) и **recalculate existing access** (`recalculate_existing: true`)

**Правило эксплуатации для админа:**
- Новые оплаты после изменения rules обрабатываются автоматически обычным fulfillment flow
- Старые исторические покупки автоматически НЕ пересчитываются
- Для них админ вручную запускает RetroApply: preview → execute

---

## PATCH-A: CB20 expiry alignment

**Статус:** ✅ Закрыт по data-proof

| entitlement_id | email | old_expires_at | new_expires_at | business_subscription_id | audit_log_id |
|---|---|---|---|---|---|
| 16f8ab42 | meryloiko@gmail.com | 2026-04-08T12:00 | 2026-05-07T20:59:59 | bb566466 | a1d5633e |
| f555a2e9 | ossiptschik@mail.ru | 2026-04-08T12:00 | 2026-05-07T20:59:59 | c3657287 | e5b948d5 |
| 144583fd | teterya@tut.by | 2026-04-08T12:00 | 2026-05-07T20:59:59 | 9bfa9ecf | 357a86c7 |

**DoD:** cb20 active with BUSINESS = 90, aligned = 90, drift = 0, audit_logs записаны.

---

## PATCH-B: Деньги BY retro-backfill

**Статус:** ✅ Закрыт по proof

- total_business_users = 110
- money_by_active_entitlements = 110
- created_by_batch = 109
- existed_before_batch = 1
- still_missing = 0, duplicates = 0

---

## PATCH-C: LibraryModule child access filtering

**Статус:** ✅ Закрыт как UI access-filter fix

**Граница:** Решает ТОЛЬКО утечку child modules в UI. НЕ восстанавливает модули, НЕ меняет entitlements.

---

## PATCH-D: Universal RetroApply Engine

**Статус:** ✅ Code-ready, preview/execute/idempotency verified, UI создан

**Execute-proof (rule 6ba9727e):** 110 total, 0 creates, 0 updates, idempotency verified.

**STOP-guards:** >200 missing_access, conflict_existing > 0, no_source_window > 0

---

## Статусный блок

| PATCH | Описание | Статус |
|---|---|---|
| A | cb20 expiry alignment | Закрыт по data-proof |
| B | Деньги BY retro-backfill | Закрыт по proof |
| C | LibraryModule child access filtering | Закрыт как UI access-filter fix |
| D | Universal rules-retroapply engine | done |
