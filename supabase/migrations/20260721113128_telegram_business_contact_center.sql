-- Telegram Business / Secretary Mode support for the contact centre.
-- The bot token remains in telegram_bots; this table stores only Telegram's
-- revocable business connection identifier and capability snapshot.

CREATE TABLE public.telegram_business_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES public.telegram_bots(id) ON DELETE CASCADE,
  connection_id text NOT NULL,
  business_user_id bigint NOT NULL,
  user_chat_id bigint,
  first_name text,
  last_name text,
  username text,
  can_reply boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  rights jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_business_connections_bot_connection_key UNIQUE (bot_id, connection_id)
);

CREATE INDEX telegram_business_connections_active_idx
  ON public.telegram_business_connections (bot_id, is_enabled, last_event_at DESC);

ALTER TABLE public.telegram_business_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Communication viewers can view Telegram business connections"
  ON public.telegram_business_connections
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));

CREATE POLICY "Communication managers can manage Telegram business connections"
  ON public.telegram_business_connections
  FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

GRANT SELECT ON public.telegram_business_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_business_connections TO service_role;

ALTER TABLE public.telegram_messages
  ADD COLUMN IF NOT EXISTS transport text NOT NULL DEFAULT 'bot',
  ADD COLUMN IF NOT EXISTS business_connection_id text,
  ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES public.telegram_business_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_origin text;

ALTER TABLE public.telegram_messages
  ADD CONSTRAINT telegram_messages_transport_check
    CHECK (transport IN ('bot', 'business')),
  ADD CONSTRAINT telegram_messages_origin_check
    CHECK (message_origin IS NULL OR message_origin IN ('client', 'owner_manual', 'crm_operator', 'bot_automation')),
  ADD CONSTRAINT telegram_messages_business_shape_check
    CHECK (
      (transport = 'bot' AND business_connection_id IS NULL)
      OR
      (transport = 'business' AND business_connection_id IS NOT NULL)
    );

CREATE UNIQUE INDEX telegram_messages_business_dedupe_idx
  ON public.telegram_messages (bot_id, business_connection_id, telegram_user_id, message_id);

CREATE INDEX telegram_messages_business_dialog_idx
  ON public.telegram_messages (business_connection_id, telegram_user_id, created_at DESC)
  WHERE transport = 'business';

COMMENT ON TABLE public.telegram_business_connections IS
  'Revocable Telegram Business connections used to mirror personal-account chats into the contact centre.';
COMMENT ON COLUMN public.telegram_messages.transport IS
  'bot for ordinary Bot API chats; business for messages sent on behalf of a connected Telegram account.';
