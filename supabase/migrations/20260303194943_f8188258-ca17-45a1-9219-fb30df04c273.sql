
-- PATCH-5: Add peer_id, sent_by_admin, recipient_id, sending_at, sending_lock_id to instagram_messages
ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS peer_id text;
ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS sent_by_admin uuid;
ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS recipient_id text;
ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS sending_at timestamptz;
ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS sending_lock_id uuid;

-- Backfill: inbound messages get peer_id = sender_id
UPDATE public.instagram_messages 
SET peer_id = sender_id 
WHERE peer_id IS NULL AND direction = 'inbound';

-- Backfill: outbound messages - peer_id should NOT be 'admin'/'system'
-- For outbound with ig_thread_id, try to find a real peer from inbound messages in same thread
UPDATE public.instagram_messages om
SET peer_id = sub.real_peer
FROM (
  SELECT DISTINCT ON (o.id) o.id, im.sender_id AS real_peer
  FROM public.instagram_messages o
  JOIN public.instagram_messages im 
    ON im.instagram_account_id = o.instagram_account_id
    AND im.ig_thread_id = o.ig_thread_id
    AND im.direction = 'inbound'
  WHERE o.direction = 'outbound' AND o.peer_id IS NULL AND o.ig_thread_id IS NOT NULL
) sub
WHERE om.id = sub.id;

-- For remaining outbound without thread match, use a fallback: 
-- find any inbound message in the same account (heuristic for single-peer accounts)
-- but safer: just set peer_id = 'unknown' to avoid NULL constraint issues
UPDATE public.instagram_messages 
SET peer_id = 'unknown'
WHERE peer_id IS NULL AND direction = 'outbound';

-- Now make peer_id NOT NULL
ALTER TABLE public.instagram_messages ALTER COLUMN peer_id SET NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ig_msg_peer_dialog 
  ON public.instagram_messages(instagram_account_id, peer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_outbox_status 
  ON public.instagram_messages(instagram_account_id, status, created_at);

-- PATCH-5: Update RPC get_instagram_dialogs_v1 to use peer_id
CREATE OR REPLACE FUNCTION public.get_instagram_dialogs_v1(p_account_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (
      COALESCE(ig_thread_id, peer_id)
    )
      id,
      instagram_account_id,
      COALESCE(ig_thread_id, peer_id) AS thread_key,
      peer_id,
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
      AND peer_id != 'unknown'
    ORDER BY COALESCE(ig_thread_id, peer_id), created_at DESC
  ),
  unread AS (
    SELECT
      COALESCE(ig_thread_id, peer_id) AS thread_key,
      count(*) AS unread_count
    FROM public.instagram_messages
    WHERE instagram_account_id = p_account_id
      AND is_read = false
      AND direction = 'inbound'
    GROUP BY COALESCE(ig_thread_id, peer_id)
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
      l.peer_id,
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
    LEFT JOIN contacts c ON c.instagram_user_id = l.peer_id
  ) d;
$$;

-- PATCH-1: Replace RLS policies with has_role_v2
-- instagram_accounts
DROP POLICY IF EXISTS "Admin access instagram_accounts" ON public.instagram_accounts;
CREATE POLICY "Admin access instagram_accounts" ON public.instagram_accounts
  FOR ALL TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- instagram_messages
DROP POLICY IF EXISTS "Admin access instagram_messages" ON public.instagram_messages;
CREATE POLICY "Admin access instagram_messages" ON public.instagram_messages
  FOR ALL TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- instagram_contacts
DROP POLICY IF EXISTS "Admin access instagram_contacts" ON public.instagram_contacts;
CREATE POLICY "Admin access instagram_contacts" ON public.instagram_contacts
  FOR ALL TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  );
