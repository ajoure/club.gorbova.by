-- ─────────────────────────────────────────────────────────────
-- Step H: instagram_dialog_preferences (per-admin pin)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.instagram_dialog_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  instagram_account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  thread_key TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  pinned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, instagram_account_id, thread_key)
);

CREATE INDEX IF NOT EXISTS idx_ig_dialog_prefs_admin
  ON public.instagram_dialog_preferences (admin_user_id, instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_ig_dialog_prefs_pinned
  ON public.instagram_dialog_preferences (admin_user_id, is_pinned)
  WHERE is_pinned = true;

ALTER TABLE public.instagram_dialog_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin sees own ig prefs"
  ON public.instagram_dialog_preferences
  FOR SELECT
  TO authenticated
  USING (admin_user_id = auth.uid());

CREATE POLICY "admin inserts own ig prefs"
  ON public.instagram_dialog_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (admin_user_id = auth.uid());

CREATE POLICY "admin updates own ig prefs"
  ON public.instagram_dialog_preferences
  FOR UPDATE
  TO authenticated
  USING (admin_user_id = auth.uid())
  WITH CHECK (admin_user_id = auth.uid());

CREATE POLICY "admin deletes own ig prefs"
  ON public.instagram_dialog_preferences
  FOR DELETE
  TO authenticated
  USING (admin_user_id = auth.uid());

CREATE TRIGGER trg_ig_dialog_prefs_updated_at
  BEFORE UPDATE ON public.instagram_dialog_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- Fix mc:* leak в RPC get_instagram_dialogs_v1
-- account_name НИКОГДА не должен содержать synthetic mc:* prefix
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_instagram_dialogs_v1(p_account_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH latest AS (
    SELECT DISTINCT ON (COALESCE(ig_thread_id, peer_id))
      id, instagram_account_id,
      COALESCE(ig_thread_id, peer_id) AS thread_key,
      peer_id, sender_id, sender_name, ig_thread_id,
      message_text, media_url, media_type,
      direction, status, created_at
    FROM public.instagram_messages
    WHERE instagram_account_id = p_account_id
      AND peer_id != 'unknown'
    ORDER BY COALESCE(ig_thread_id, peer_id), created_at DESC
  ),
  unread AS (
    SELECT COALESCE(ig_thread_id, peer_id) AS thread_key,
           count(*) AS unread_count
    FROM public.instagram_messages
    WHERE instagram_account_id = p_account_id
      AND is_read = false
      AND direction = 'inbound'
    GROUP BY COALESCE(ig_thread_id, peer_id)
  ),
  contacts AS (
    SELECT instagram_user_id, instagram_username, full_name, avatar_url, profile_id
    FROM public.instagram_contacts
    WHERE instagram_account_id = p_account_id
  ),
  acct AS (
    SELECT
      ia.id AS account_id,
      -- account_name: synthetic mc:* идентификаторы строго отфильтрованы.
      -- Fallback chain: config.account_name → display_name → NULL (никогда mc:*).
      COALESCE(
        NULLIF(ii.config->>'account_name', ''),
        NULLIF(ii.config->>'manychat_page_name', '')
      ) AS account_name,
      NULLIF(ii.config->>'manychat_page_name', '') AS display_name,
      ia.provider_kind,
      ia.integration_instance_id
    FROM public.instagram_accounts ia
    LEFT JOIN public.integration_instances ii ON ii.id = ia.integration_instance_id
    WHERE ia.id = p_account_id
    LIMIT 1
  )
  SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.last_at DESC), '[]'::json)
  FROM (
    SELECT
      l.thread_key, l.peer_id, l.sender_id, l.sender_name, l.ig_thread_id,
      l.message_text AS last_message,
      CASE WHEN l.media_type IS NOT NULL AND l.media_type != 'avatar'
           THEN l.media_url ELSE NULL END AS last_media_url,
      l.media_type AS last_media_type,
      l.direction AS last_direction,
      l.created_at AS last_at,
      COALESCE(u.unread_count, 0) AS unread_count,
      c.instagram_username, c.full_name, c.avatar_url, c.profile_id,
      a.account_name, a.display_name, a.provider_kind, a.integration_instance_id
    FROM latest l
    LEFT JOIN unread u ON u.thread_key = l.thread_key
    LEFT JOIN contacts c ON c.instagram_user_id = l.peer_id
    CROSS JOIN acct a
  ) d;
$function$;