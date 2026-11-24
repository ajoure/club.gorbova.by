-- SMS is an existing broadcast/funnel transport. No recipients or campaigns are seeded.
CREATE OR REPLACE FUNCTION public.sms_normalize_phone(p_phone text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g') ~ '^\+?[0-9]{8,15}$'
 THEN '+'||ltrim(regexp_replace(p_phone,'[^0-9+]','','g'),'+') END;
$$;
REVOKE ALL ON FUNCTION public.sms_normalize_phone(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_normalize_phone(text) TO service_role;
-- Every existing browser write already goes through websms-send. Durable rows cannot
-- be requeued or stripped of their dispatch key by staff Data API writes.
REVOKE INSERT,UPDATE,DELETE ON public.sms_messages FROM authenticated,anon;
CREATE TABLE public.sms_broadcast_dispatches(
 id uuid PRIMARY KEY, actor_id uuid REFERENCES auth.users(id), request_key text NOT NULL UNIQUE,
 text text NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 1000), filters jsonb NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_broadcast_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_broadcast_dispatches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sms_broadcast_dispatches TO authenticated;
GRANT ALL ON public.sms_broadcast_dispatches TO service_role;
CREATE POLICY sms_dispatch_staff_read ON public.sms_broadcast_dispatches FOR SELECT TO authenticated
 USING(public.telegram_funnel_can_manage());
ALTER TABLE public.sms_messages ADD COLUMN dispatch_id uuid REFERENCES public.sms_broadcast_dispatches(id);
ALTER TABLE public.sms_messages ADD COLUMN dispatch_key text;
CREATE UNIQUE INDEX sms_messages_dispatch_key ON public.sms_messages(dispatch_key) WHERE dispatch_key IS NOT NULL;
CREATE INDEX sms_messages_dispatch_queue ON public.sms_messages(created_at,id) WHERE status='queued' AND dispatch_key IS NOT NULL;
