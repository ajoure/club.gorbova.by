-- =============================================
-- PATCH 1: Live Events v2
-- =============================================

-- 1. Extend live_events
ALTER TABLE public.live_events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'recorded_webinar',
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'kinescope_video',
  ADD COLUMN IF NOT EXISTS event_timezone TEXT NOT NULL DEFAULT 'Europe/Minsk',
  ADD COLUMN IF NOT EXISTS kinescope_live_event_id TEXT,
  ADD COLUMN IF NOT EXISTS kinescope_project_id TEXT,
  ADD COLUMN IF NOT EXISTS kinescope_stream_id TEXT,
  ADD COLUMN IF NOT EXISTS platform_status TEXT NOT NULL DEFAULT 'draft';

UPDATE public.live_events SET platform_status = status WHERE platform_status = 'draft' AND status != 'draft';

-- 2. Canonical access helper
CREATE OR REPLACE FUNCTION public.user_has_live_event_access(_user_id UUID, _live_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND r.code IN ('admin', 'super_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.live_event_access_rules lear
    WHERE lear.live_event_id = _live_event_id
      AND (
        EXISTS (
          SELECT 1 FROM public.subscriptions_v2 s
          WHERE s.user_id = _user_id
            AND s.product_id = lear.product_id
            AND s.status::text IN ('active', 'past_due')
            AND (s.access_end_at IS NULL OR s.access_end_at > now())
            AND (lear.tariff_id IS NULL OR s.tariff_id = lear.tariff_id)
        )
        OR
        EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.user_id = _user_id
            AND e.product_id = lear.product_id
            AND e.status = 'active'
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.live_access_proofs lap
    WHERE lap.live_event_id = _live_event_id
      AND lap.user_id = _user_id
      AND (lap.expires_at IS NULL OR lap.expires_at > now())
  );
$$;

-- 3. Comments table
CREATE TABLE public.live_event_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lec_event ON public.live_event_comments(live_event_id);
CREATE INDEX idx_lec_user ON public.live_event_comments(user_id);
ALTER TABLE public.live_event_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with access can read comments"
  ON public.live_event_comments FOR SELECT TO authenticated
  USING (public.user_has_live_event_access(auth.uid(), live_event_id));

CREATE POLICY "Users with access can insert own comments"
  ON public.live_event_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.user_has_live_event_access(auth.uid(), live_event_id));

CREATE POLICY "Admins can delete comments"
  ON public.live_event_comments FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'));

-- 4. Questions table
CREATE TABLE public.live_event_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  is_answered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leq_event ON public.live_event_questions(live_event_id);
CREATE INDEX idx_leq_user ON public.live_event_questions(user_id);
ALTER TABLE public.live_event_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with access can read questions"
  ON public.live_event_questions FOR SELECT TO authenticated
  USING (public.user_has_live_event_access(auth.uid(), live_event_id));

CREATE POLICY "Users with access can insert own questions"
  ON public.live_event_questions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.user_has_live_event_access(auth.uid(), live_event_id));

CREATE POLICY "Admins can update questions"
  ON public.live_event_questions FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete questions"
  ON public.live_event_questions FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'));

-- 5. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_questions;