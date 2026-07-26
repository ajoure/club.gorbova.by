-- SECURITY: Realtime Broadcast/Presence must not be globally readable or writable.
--
-- The prior policies allowed every authenticated user to SELECT/INSERT every
-- `realtime.messages` topic with `USING (true)` / `WITH CHECK (true)`.  They
-- did not protect the postgres_changes channels used by the application; they
-- only made Broadcast and Presence topics globally open.  No application
-- client currently uses a Broadcast/Presence channel, so deny them by default
-- until a resource-scoped policy is introduced with an explicit topic contract.

DROP POLICY IF EXISTS "authenticated can receive realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "authenticated can send realtime messages" ON realtime.messages;
