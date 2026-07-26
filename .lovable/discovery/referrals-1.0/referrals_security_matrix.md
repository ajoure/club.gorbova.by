# План: безопасность

- RLS на каждой exposed table; ownership через `profiles.user_id = auth.uid()`.
- `authenticated` без ownership predicate запрещён.
- Финансовые записи — только backend/RPC; revoke execute from PUBLIC, точечные grants.
- SECURITY DEFINER только при необходимости, фиксированный `search_path`, внутренний auth/RBAC check.
- IP/User-Agent только salted hash и retention.
- Банковские реквизиты не хранить открытым JSON.
- Partner видит только агрегаты и допустимые данные приглашённого, без лишнего PII.
- Новые таблицы требуют проверки Data API exposure/grants из-за изменения Supabase 2026-04-28.
