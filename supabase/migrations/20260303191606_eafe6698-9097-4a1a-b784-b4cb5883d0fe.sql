
-- Instagram Direct via ApiX-Drive: tables, RLS, RPC, realtime

-- 1. instagram_accounts
CREATE TABLE public.instagram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_instance_id uuid NOT NULL REFERENCES public.integration_instances(id) ON DELETE CASCADE,
  instagram_page_id text,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_instance_id, instagram_page_id)
);

ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access instagram_accounts"
  ON public.instagram_accounts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));

CREATE POLICY "Service role access instagram_accounts"
  ON public.instagram_accounts FOR ALL TO service_role
  USING (true);

CREATE TRIGGER update_instagram_accounts_updated_at
  BEFORE UPDATE ON public.instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. instagram_messages
CREATE TABLE public.instagram_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  external_message_id text,
  sender_id text NOT NULL,
  sender_name text,
  ig_thread_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_text text,
  media_url text,
  media_type text,
  raw_payload jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  status text NOT NULL DEFAULT 'delivered',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, external_message_id)
);

ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access instagram_messages"
  ON public.instagram_messages FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));

CREATE POLICY "Service role access instagram_messages"
  ON public.instagram_messages FOR ALL TO service_role
  USING (true);

CREATE INDEX idx_instagram_messages_dialog
  ON public.instagram_messages (instagram_account_id, sender_id, created_at DESC);

CREATE INDEX idx_instagram_messages_unread
  ON public.instagram_messages (instagram_account_id, is_read)
  WHERE is_read = false;

-- 3. instagram_contacts
CREATE TABLE public.instagram_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  instagram_user_id text NOT NULL,
  instagram_username text,
  profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, instagram_user_id)
);

ALTER TABLE public.instagram_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access instagram_contacts"
  ON public.instagram_contacts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));

CREATE POLICY "Service role access instagram_contacts"
  ON public.instagram_contacts FOR ALL TO service_role
  USING (true);

CREATE TRIGGER update_instagram_contacts_updated_at
  BEFORE UPDATE ON public.instagram_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_messages;

-- 5. RPC: get_instagram_dialogs_v1
CREATE OR REPLACE FUNCTION public.get_instagram_dialogs_v1(p_account_id uuid)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (
      COALESCE(ig_thread_id, sender_id)
    )
      id,
      instagram_account_id,
      COALESCE(ig_thread_id, sender_id) AS thread_key,
      sender_id,
      sender_name,
      ig_thread_id,
      message_text,
      media_url,
      media_type,
      direction,
      status,
      created_at
    FROM public.instagram_messages
    WHERE instagram_account_id = p_account_id
    ORDER BY COALESCE(ig_thread_id, sender_id), created_at DESC
  ),
  unread AS (
    SELECT
      COALESCE(ig_thread_id, sender_id) AS thread_key,
      count(*) AS unread_count
    FROM public.instagram_messages
    WHERE instagram_account_id = p_account_id
      AND is_read = false
      AND direction = 'inbound'
    GROUP BY COALESCE(ig_thread_id, sender_id)
  ),
  contacts AS (
    SELECT
      instagram_user_id,
      instagram_username,
      profile_id
    FROM public.instagram_contacts
    WHERE instagram_account_id = p_account_id
  )
  SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.last_at DESC), '[]'::json)
  FROM (
    SELECT
      l.thread_key,
      l.sender_id,
      l.sender_name,
      l.ig_thread_id,
      l.message_text AS last_message,
      l.media_url AS last_media_url,
      l.direction AS last_direction,
      l.created_at AS last_at,
      COALESCE(u.unread_count, 0) AS unread_count,
      c.instagram_username,
      c.profile_id
    FROM latest l
    LEFT JOIN unread u ON u.thread_key = l.thread_key
    LEFT JOIN contacts c ON c.instagram_user_id = l.sender_id
  ) d;
$$;
