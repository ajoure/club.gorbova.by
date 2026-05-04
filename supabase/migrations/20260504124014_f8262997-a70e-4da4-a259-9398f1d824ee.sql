CREATE TABLE IF NOT EXISTS public.lesson_progress_state_backup_byn_2026_05 (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  state_json_before jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lesson_progress_state_backup_byn_2026_05 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "superadmin_read_backup_byn_2026_05" ON public.lesson_progress_state_backup_byn_2026_05;
CREATE POLICY "superadmin_read_backup_byn_2026_05"
  ON public.lesson_progress_state_backup_byn_2026_05
  FOR SELECT
  USING (public.has_role_v2(auth.uid(), 'superadmin'));