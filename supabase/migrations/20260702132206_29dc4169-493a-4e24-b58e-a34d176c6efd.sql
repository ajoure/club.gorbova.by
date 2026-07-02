-- Оптимизация RLS-политик client_legal_details:
-- заменяем прямые вызовы auth.uid() на (select auth.uid()),
-- чтобы Postgres вычислял значение один раз, а не для каждой строки.
-- Это устраняет статистически стабильный statement timeout при insert
-- в сценарии добавления ЮЛ (форма Реквизиты).

DROP POLICY IF EXISTS "Users can view own legal details" ON public.client_legal_details;
DROP POLICY IF EXISTS "Users can insert own legal details" ON public.client_legal_details;
DROP POLICY IF EXISTS "Users can update own legal details" ON public.client_legal_details;
DROP POLICY IF EXISTS "Users can delete own legal details" ON public.client_legal_details;
DROP POLICY IF EXISTS "Admins can manage all legal details" ON public.client_legal_details;

CREATE POLICY "Users can view own legal details"
  ON public.client_legal_details
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM public.profiles
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own legal details"
  ON public.client_legal_details
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM public.profiles
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own legal details"
  ON public.client_legal_details
  FOR UPDATE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM public.profiles
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    profile_id IN (
      SELECT id FROM public.profiles
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete own legal details"
  ON public.client_legal_details
  FOR DELETE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM public.profiles
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can manage all legal details"
  ON public.client_legal_details
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = (SELECT auth.uid())
        AND r.code = ANY (ARRAY['super_admin','admin'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = (SELECT auth.uid())
        AND r.code = ANY (ARRAY['super_admin','admin'])
    )
  );