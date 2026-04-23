-- 1. Helper: определение ведущего эфира (SoT — live_events.metadata->>'presenter_user_id')
CREATE OR REPLACE FUNCTION public.is_live_event_presenter(_user_id uuid, _live_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.live_events le
    WHERE le.id = _live_event_id
      AND (le.metadata->>'presenter_user_id')::uuid = _user_id
  );
$$;

-- 2. Поля статуса ответа
ALTER TABLE public.live_event_questions
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS answered_by uuid;

-- 3. Индекс для быстрого подсчёта неотвеченных
CREATE INDEX IF NOT EXISTS idx_live_event_questions_unanswered
  ON public.live_event_questions (live_event_id)
  WHERE is_answered = false;

-- 4. Privacy SELECT: staff/presenter видят всё, обычный участник — только свои
DROP POLICY IF EXISTS "Users with access can read questions" ON public.live_event_questions;

CREATE POLICY "Staff read all, users read own"
  ON public.live_event_questions
  FOR SELECT
  TO authenticated
  USING (
    user_has_live_event_access(auth.uid(), live_event_id)
    AND (
      auth.uid() = user_id
      OR has_role_v2(auth.uid(), 'admin')
      OR has_role_v2(auth.uid(), 'super_admin')
      OR has_role_v2(auth.uid(), 'employee')
      OR is_live_event_presenter(auth.uid(), live_event_id)
    )
  );

-- 5. UPDATE: расширяем admin → staff/presenter (нужно для mark-as-answered у employee/ведущего)
DROP POLICY IF EXISTS "Admins can update questions" ON public.live_event_questions;

CREATE POLICY "Staff can update questions"
  ON public.live_event_questions
  FOR UPDATE
  TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
    OR has_role_v2(auth.uid(), 'employee')
    OR is_live_event_presenter(auth.uid(), live_event_id)
  );

-- DELETE policy НЕ трогаем (вне scope этого PATCH).