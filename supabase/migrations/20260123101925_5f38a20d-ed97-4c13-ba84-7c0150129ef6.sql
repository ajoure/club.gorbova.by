-- PATCH 14.5: Удалить старую версию функции find_wrongly_revoked_users с p_limit
DROP FUNCTION IF EXISTS find_wrongly_revoked_users(integer);