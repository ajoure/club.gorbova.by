-- Existing Contacts queries filter visible profiles and sort by the cursor
-- pair (created_at, id). These indexes add no new data model or constraints.

CREATE INDEX IF NOT EXISTS profiles_contacts_visible_cursor_idx
  ON public.profiles (created_at DESC, id DESC)
  WHERE coalesce(is_archived, false) = false
    AND status <> 'archived'
    AND merged_to_profile_id IS NULL;

CREATE INDEX IF NOT EXISTS profiles_contacts_archived_cursor_idx
  ON public.profiles (created_at DESC, id DESC)
  WHERE status = 'archived'
     OR coalesce(is_archived, false) = true
     OR merged_to_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_v2_paid_profile_created_idx
  ON public.orders_v2 (profile_id, created_at DESC)
  WHERE status = 'paid' AND profile_id IS NOT NULL;
