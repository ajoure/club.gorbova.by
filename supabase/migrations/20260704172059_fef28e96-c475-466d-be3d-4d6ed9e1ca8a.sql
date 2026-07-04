
ALTER TABLE public.instagram_dialog_preferences
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS favorited_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ig_dialog_prefs_favorite
  ON public.instagram_dialog_preferences (admin_user_id, is_favorite)
  WHERE is_favorite = true;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_support_tickets_pinned
  ON public.support_tickets (is_pinned)
  WHERE is_pinned = true;
