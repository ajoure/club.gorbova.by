-- Разрешить админам читать журнал выдачи доступов для ленты карточки контакта
GRANT SELECT ON public.access_grant_ledger TO authenticated;

CREATE POLICY "agl_admins_read"
  ON public.access_grant_ledger
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));