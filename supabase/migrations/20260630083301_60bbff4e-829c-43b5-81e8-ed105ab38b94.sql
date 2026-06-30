CREATE TABLE IF NOT EXISTS public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  contact_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deal_id uuid,
  phone_e164 text NOT NULL,
  text text NOT NULL,
  provider text NOT NULL DEFAULT 'websms',
  status text NOT NULL DEFAULT 'queued',
  external_id text,
  sender text,
  error text,
  cost numeric,
  segments int,
  initiator_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_contact ON public.sms_messages(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_deal ON public.sms_messages(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_phone ON public.sms_messages(phone_e164, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_messages_staff_read" ON public.sms_messages
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "sms_messages_staff_insert" ON public.sms_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

CREATE POLICY "sms_messages_staff_update" ON public.sms_messages
  FOR UPDATE TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'employee')
    OR public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

ALTER TABLE public.sms_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_messages;