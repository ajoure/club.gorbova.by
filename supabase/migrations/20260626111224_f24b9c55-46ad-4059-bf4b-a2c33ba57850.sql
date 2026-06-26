
DROP POLICY IF EXISTS "RBAC v3: view telegram bots" ON public.telegram_bots;
DROP POLICY IF EXISTS "RBAC v3: manage telegram bots" ON public.telegram_bots;
CREATE POLICY "RBAC v3: view telegram bots" ON public.telegram_bots
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));
CREATE POLICY "RBAC v3: manage telegram bots" ON public.telegram_bots
  FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

DROP POLICY IF EXISTS "RBAC v3: view telegram clubs" ON public.telegram_clubs;
DROP POLICY IF EXISTS "RBAC v3: manage telegram clubs" ON public.telegram_clubs;
CREATE POLICY "RBAC v3: view telegram clubs" ON public.telegram_clubs
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));
CREATE POLICY "RBAC v3: manage telegram clubs" ON public.telegram_clubs
  FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

DROP POLICY IF EXISTS "RBAC v3: view club members" ON public.telegram_club_members;
DROP POLICY IF EXISTS "RBAC v3: manage club members" ON public.telegram_club_members;
CREATE POLICY "RBAC v3: view club members" ON public.telegram_club_members
  FOR SELECT TO authenticated
  USING (
    public.has_admin_section_access(auth.uid(), 'communication', 'view')
    OR public.has_admin_section_access(auth.uid(), 'contacts', 'view')
  );
CREATE POLICY "RBAC v3: manage club members" ON public.telegram_club_members
  FOR ALL TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'))
  WITH CHECK (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

DROP POLICY IF EXISTS "RBAC v3: view telegram logs" ON public.telegram_logs;
CREATE POLICY "RBAC v3: view telegram logs" ON public.telegram_logs
  FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));

CREATE INDEX IF NOT EXISTS idx_generated_documents_order_id ON public.generated_documents(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_reconcile_queue_status_paid_at ON public.payment_reconcile_queue(status, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_user_created ON public.telegram_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_chat_messages_chat_created ON public.tg_chat_messages(chat_id, created_at DESC);
