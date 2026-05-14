CREATE TABLE IF NOT EXISTS public.lesson_progress_state_backup_byn_x3_revert_2026_05_13 (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  state_json_before jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lesson_progress_state_backup_byn_x3_revert_2026_05_13 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_read_revert_backup_2026_05_13"
ON public.lesson_progress_state_backup_byn_x3_revert_2026_05_13
FOR SELECT
USING (public.has_role_v2(auth.uid(), 'superadmin'::text));