-- Security follow-up for the contact-center RPC surface.
-- Project-level default privileges grant EXECUTE directly to anon for newly
-- created functions, so revoking PUBLIC alone is not sufficient.

REVOKE ALL ON FUNCTION public.resolve_telegram_conversation_v1(uuid, timestamptz, text, uuid, uuid, uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_contact_center_unanswered_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_contact_center_unanswered_dialogs_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_contact_center_unanswered_total_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_contact_center_message_v1(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_contact_center_assignments_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_contact_center_assignees_v1() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.resolve_telegram_conversation_v1(uuid, timestamptz, text, uuid, uuid, uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_contact_center_unanswered_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_center_unanswered_dialogs_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_center_unanswered_total_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_contact_center_message_v1(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_center_assignments_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_center_assignees_v1() TO authenticated;
