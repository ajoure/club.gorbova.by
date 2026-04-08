# section_access — текущий статус

## Готовые документы

1. **Отчёт о Discovery:** `docs/section-access/01-discovery-report.md`
   - Proof/факты: 34 правила, 0 email/entitlement, CHECK constraint, runtime flow
   - Assumptions/decisions: SoT, mapping, auth model, fallback
   - Риски: 8 идентифицированных с митигацией

2. **План реализации:** `docs/section-access/02-implementation-plan.md`
   - DDL: app_sections + RLS + seed + ALTER CHECK + RPC (plpgsql, SECURITY DEFINER)
   - 3 этапа: infrastructure → тестовая секция (eisenhower) → остальные
   - 25 обязательных DoD-proof
   - Compatibility checklist (10 пунктов)
   - Kill-switch (3 уровня)

## Следующий шаг

Утверждение обоих документов → переход к SQL миграциям (этап 1).
Переход к коду без утверждения запрещён.
