# План: rollout Referrals 1.0

1. Получить read-only Supabase доступ и завершить production diagnose.
2. Зафиксировать три бизнес-решения и architecture freeze.
3. Add-only DDL с flags off; dry-run, advisors, migration proof.
4. Backend atomic attribution/ledger/refund/reconcile с unit/SQL tests.
5. Tracking только shadow mode.
6. Admin UI и вкладки существующих карточек.
7. Partner portal и non-blocking notifications.
8. Один тестовый партнёр/продукт, затем 3–5 пилотных.
9. Включать tracking → accrual → portal → payouts раздельно.

Rollback: выключение flags/consumers без удаления таблиц, touchpoints и ledger.
