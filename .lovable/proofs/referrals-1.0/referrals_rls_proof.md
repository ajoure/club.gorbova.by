# Отчет о выполненной работе: RLS proof

RLS включён на всех новых таблицах. Партнёр читает только строки своего `profiles.user_id`; администратор — через `has_role_v2`. Прямые INSERT/UPDATE/DELETE ledger для authenticated не выданы. Runtime proof deferred до Lovable preview.
