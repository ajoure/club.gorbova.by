-- Fix: менеджеры (и другие сотрудники) не видят звонки, SMS, письма и доступы
-- в карточке контакта и в контакт-центре.
--
-- Причины:
-- 1) RLS на public.calls / public.sms_messages / public.call_events требует
--    has_role_v2(uid,'employee'), но в roles нет кода 'employee' — функция
--    всегда возвращает false для не-админов.
-- 2) public.email_threads имеет только legacy-политику для admin/superadmin;
--    у email_inbox уже есть RBAC v3 view по communication-секции — добавим
--    аналогичную для threads.
-- 3) Просмотр entitlements требует 'entitlements.view' (= секция payments),
--    но менеджеры с доступом к contacts должны видеть «Доступы» в карточке.
--
-- Решение:
-- A) В has_role_v2 трактовать виртуальный код 'employee' как «любая роль,
--    кроме базового user» (umbrella для сотрудников). Это совпадает с
--    задокументированным каноном RBAC v2 («consolidated employee role»).
-- B) Добавить RBAC v3 SELECT/ALL политики на email_threads + call_events.
-- C) Добавить SELECT-политику на entitlements для пользователей с доступом
--    к секции contacts (view).

CREATE OR REPLACE FUNCTION public.has_role_v2(_user_id uuid, _role_code text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    -- Виртуальный umbrella-код: любой сотрудник (не базовый 'user')
    WHEN _role_code = 'employee' THEN EXISTS (
      SELECT 1
      FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = _user_id
        AND r.code <> 'user'
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles_v2 ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = _user_id
        AND r.code = CASE _role_code
          WHEN 'super-admin' THEN 'super_admin'
          WHEN 'superadmin'  THEN 'super_admin'
          ELSE _role_code
        END
    )
  END;
$$;

-- email_threads: дать сотрудникам с доступом к communication видеть треды
DROP POLICY IF EXISTS "RBAC v3: view email threads by communication section" ON public.email_threads;
CREATE POLICY "RBAC v3: view email threads by communication section"
  ON public.email_threads
  FOR SELECT
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'view'));

DROP POLICY IF EXISTS "RBAC v3: manage email threads by communication section" ON public.email_threads;
CREATE POLICY "RBAC v3: manage email threads by communication section"
  ON public.email_threads
  FOR UPDATE
  USING (public.has_admin_section_access(auth.uid(), 'communication', 'manage'));

-- call_events: дать сотрудникам с доступом к calls видеть события звонков
DROP POLICY IF EXISTS "RBAC v3: view call_events by calls section" ON public.call_events;
CREATE POLICY "RBAC v3: view call_events by calls section"
  ON public.call_events
  FOR SELECT
  USING (public.has_admin_section_access(auth.uid(), 'calls', 'view'));

-- entitlements: пользователи с доступом к contacts (view) должны видеть
-- «Доступы» в карточке контакта.
DROP POLICY IF EXISTS "Staff with contacts access can view entitlements" ON public.entitlements;
CREATE POLICY "Staff with contacts access can view entitlements"
  ON public.entitlements
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'contacts', 'view'));