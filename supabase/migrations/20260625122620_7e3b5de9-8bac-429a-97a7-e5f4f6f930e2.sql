
-- ============================================================
-- RBAC v3 — Migration D
-- ============================================================

-- 1) FIX audit в sync_admin_menu_registry
CREATE OR REPLACE FUNCTION public.sync_admin_menu_registry(_payload jsonb)
RETURNS TABLE (
  sections_added int, sections_updated int, sections_disabled int,
  resources_added int, resources_updated int, resources_disabled int
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_sec_added int := 0; v_sec_updated int := 0; v_sec_disabled int := 0;
  v_res_added int := 0; v_res_updated int := 0; v_res_disabled_total int := 0;
  v_res_disabled_step int := 0;
  v_section_codes text[];
  v_section jsonb;
  v_existing_section public.admin_section%ROWTYPE;
  v_section_id uuid;
  v_resource jsonb;
  v_resource_codes text[];
  v_existing_resource public.admin_resource%ROWTYPE;
BEGIN
  v_is_admin := v_actor IS NOT NULL AND (
    public.has_role_v2(v_actor,'super_admin') OR public.has_role_v2(v_actor,'admin')
  );
  IF NOT v_is_admin AND v_actor IS NOT NULL THEN
    RAISE EXCEPTION 'sync_admin_menu_registry: forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_payload) <> 'array' THEN
    RAISE EXCEPTION 'sync_admin_menu_registry: payload must be jsonb array';
  END IF;

  v_section_codes := ARRAY(
    SELECT lower(trim(s->>'code')) FROM jsonb_array_elements(_payload) s
     WHERE coalesce(s->>'code','') <> ''
  );

  FOR v_section IN SELECT * FROM jsonb_array_elements(_payload) LOOP
    IF coalesce(v_section->>'code','') = '' THEN CONTINUE; END IF;

    SELECT * INTO v_existing_section FROM public.admin_section
     WHERE code = lower(trim(v_section->>'code'));

    IF NOT FOUND THEN
      INSERT INTO public.admin_section (code,label,route_prefix,icon,sort_order,group_code,is_active,created_by,updated_by)
      VALUES (
        lower(trim(v_section->>'code')),
        coalesce(v_section->>'label', v_section->>'code'),
        coalesce(v_section->>'route_prefix','/'),
        v_section->>'icon',
        coalesce((v_section->>'sort_order')::int, 0),
        v_section->>'group_code',
        true, v_actor, v_actor
      ) RETURNING id INTO v_section_id;
      v_sec_added := v_sec_added + 1;
    ELSE
      v_section_id := v_existing_section.id;
      UPDATE public.admin_section
         SET label = coalesce(v_section->>'label', label),
             route_prefix = coalesce(v_section->>'route_prefix', route_prefix),
             icon = coalesce(v_section->>'icon', icon),
             sort_order = coalesce((v_section->>'sort_order')::int, sort_order),
             group_code = coalesce(v_section->>'group_code', group_code),
             is_active = true,
             updated_by = v_actor
       WHERE id = v_section_id;
      v_sec_updated := v_sec_updated + 1;
    END IF;

    v_resource_codes := ARRAY[]::text[];
    IF jsonb_typeof(v_section->'resources') = 'array' THEN
      v_resource_codes := ARRAY(
        SELECT lower(trim(r->>'code')) FROM jsonb_array_elements(v_section->'resources') r
         WHERE coalesce(r->>'code','') <> ''
      );
      FOR v_resource IN SELECT * FROM jsonb_array_elements(v_section->'resources') LOOP
        IF coalesce(v_resource->>'code','') = '' THEN CONTINUE; END IF;
        SELECT * INTO v_existing_resource FROM public.admin_resource
         WHERE section_id = v_section_id AND code = lower(trim(v_resource->>'code'));
        IF NOT FOUND THEN
          INSERT INTO public.admin_resource (section_id,code,label,route,sort_order,is_active,created_by,updated_by)
          VALUES (
            v_section_id, lower(trim(v_resource->>'code')),
            coalesce(v_resource->>'label', v_resource->>'code'),
            coalesce(v_resource->>'route',''),
            coalesce((v_resource->>'sort_order')::int, 0),
            true, v_actor, v_actor
          );
          v_res_added := v_res_added + 1;
        ELSE
          UPDATE public.admin_resource
             SET label = coalesce(v_resource->>'label', label),
                 route = coalesce(v_resource->>'route', route),
                 sort_order = coalesce((v_resource->>'sort_order')::int, sort_order),
                 is_active = true, updated_by = v_actor
           WHERE id = v_existing_resource.id;
          v_res_updated := v_res_updated + 1;
        END IF;
      END LOOP;
    END IF;

    WITH disabled AS (
      UPDATE public.admin_resource SET is_active = false, updated_by = v_actor
       WHERE section_id = v_section_id AND is_active = true
         AND NOT (code = ANY(v_resource_codes))
      RETURNING 1
    )
    SELECT count(*) FROM disabled INTO v_res_disabled_step;
    v_res_disabled_total := v_res_disabled_total + coalesce(v_res_disabled_step,0);
  END LOOP;

  WITH disabled_sections AS (
    UPDATE public.admin_section SET is_active = false, updated_by = v_actor
     WHERE is_active = true AND NOT (code = ANY(v_section_codes))
    RETURNING 1
  )
  SELECT count(*) FROM disabled_sections INTO v_sec_disabled;

  -- AUDIT: real schema, без silent EXCEPTION.
  INSERT INTO public.audit_logs (action, actor_user_id, actor_type, entity_type, meta)
  VALUES (
    'admin_menu_registry.sync', v_actor,
    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
    'admin_section',
    jsonb_build_object(
      'sections_added', v_sec_added, 'sections_updated', v_sec_updated,
      'sections_disabled', coalesce(v_sec_disabled,0),
      'resources_added', v_res_added, 'resources_updated', v_res_updated,
      'resources_disabled', v_res_disabled_total,
      'source','sync_admin_menu_registry'
    )
  );

  RETURN QUERY SELECT v_sec_added, v_sec_updated, coalesce(v_sec_disabled,0),
                      v_res_added, v_res_updated, v_res_disabled_total;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_admin_menu_registry(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_admin_menu_registry(jsonb) TO authenticated, service_role;

-- 2) SEED каталога
INSERT INTO public.admin_section (code,label,route_prefix,icon,sort_order,group_code,is_active)
VALUES
  ('communication','Контакт-центр','/admin/communication','MessageCircle',0,'crm',true),
  ('deals','Сделки','/admin/deals','Handshake',1,'crm',true),
  ('contacts','Контакты','/admin/contacts','Users',2,'crm',true),
  ('payments','Платежи','/admin/payments','CreditCard',3,'crm',true),
  ('forms-hub','Анкеты и данные','/admin/forms','ClipboardList',4,'crm',true),
  ('documents','Документы','/admin/documents','FileText',0,'service',true),
  ('integrations','Интеграции','/admin/integrations','Plug',1,'service',true),
  ('sites','Конструктор сайтов','/admin/sites','PanelTop',2,'service',true),
  ('marketing','Маркетинг-инсайты','/admin/marketing','Target',3,'service',true),
  ('ai','Нейросеть','/admin/ai','Bot',4,'service',true),
  ('products','Продукты','/admin/products-v2','Layers',5,'service',true),
  ('sections','Разделы платформы','/admin/sections','Shield',6,'service',true),
  ('editorial','Редакция','/admin/editorial','Newspaper',7,'service',true),
  ('consents','Согласия','/admin/consents','ClipboardCheck',8,'service',true),
  ('roles','Сотрудники и роли','/admin/roles','Shield',9,'service',true),
  ('training','Тренинги','/admin/training-modules','GraduationCap',10,'service',true),
  ('club-members','Участники клуба','/admin/integrations/telegram','MessageCircle',11,'service',true),
  ('live-events','Эфиры','/admin/live-events','Video',12,'service',true),
  ('ilex','iLex','/admin/ilex','Library',13,'service',true),
  ('telegram-invite-audit','Telegram invite audit','/admin/telegram/invite-audit','ShieldCheck',14,'service',true),
  ('support','Поддержка','/admin/support','LifeBuoy',15,'service',true)
ON CONFLICT (code) DO UPDATE SET
  label=EXCLUDED.label, route_prefix=EXCLUDED.route_prefix, icon=EXCLUDED.icon,
  sort_order=EXCLUDED.sort_order, group_code=EXCLUDED.group_code, is_active=true, updated_at=now();

-- Resources: payments
WITH s AS (SELECT id FROM public.admin_section WHERE code='payments'),
res(code,label,route,sort_order) AS (VALUES
  ('overview','Обзор','/admin/payments',0),
  ('auto-renewals','Автопродления','/admin/payments/auto-renewals',1),
  ('statement','Выписка','/admin/payments/statement',2),
  ('links','Платёжные ссылки','/admin/payments/links',3),
  ('bepaid-subscriptions','bePaid подписки','/admin/payments/bepaid-subscriptions',4),
  ('payment-issues','Проблемы платежей','/admin/payments/payment-issues',5),
  ('diagnostics','Диагностика','/admin/payments/diagnostics',6)
)
INSERT INTO public.admin_resource (section_id,code,label,route,sort_order,is_active)
SELECT s.id, res.code, res.label, res.route, res.sort_order, true FROM s, res
ON CONFLICT (section_id,code) DO UPDATE SET
  label=EXCLUDED.label, route=EXCLUDED.route, sort_order=EXCLUDED.sort_order,
  is_active=true, updated_at=now();

-- Resources: integrations
WITH s AS (SELECT id FROM public.admin_section WHERE code='integrations'),
res(code,label,route,sort_order) AS (VALUES
  ('crm','CRM','/admin/integrations/crm',0),
  ('payments','Платежи','/admin/integrations/payments',1),
  ('email','Email','/admin/integrations/email',2),
  ('telegram','Telegram','/admin/integrations/telegram',3),
  ('socials','Соцсети','/admin/integrations/socials',4),
  ('other','Прочие','/admin/integrations/other',5)
)
INSERT INTO public.admin_resource (section_id,code,label,route,sort_order,is_active)
SELECT s.id, res.code, res.label, res.route, res.sort_order, true FROM s, res
ON CONFLICT (section_id,code) DO UPDATE SET
  label=EXCLUDED.label, route=EXCLUDED.route, sort_order=EXCLUDED.sort_order,
  is_active=true, updated_at=now();

-- Resources: communication (tabs)
WITH s AS (SELECT id FROM public.admin_section WHERE code='communication'),
res(code,label,route,sort_order) AS (VALUES
  ('inbox','Входящие','/admin/communication',0),
  ('broadcasts','Рассылки','/admin/communication?tab=broadcasts',1),
  ('email','Email','/admin/communication?tab=email',2),
  ('support','Техподдержка','/admin/communication?tab=support',3),
  ('instagram','Instagram','/admin/communication?tab=instagram',4)
)
INSERT INTO public.admin_resource (section_id,code,label,route,sort_order,is_active)
SELECT s.id, res.code, res.label, res.route, res.sort_order, true FROM s, res
ON CONFLICT (section_id,code) DO UPDATE SET
  label=EXCLUDED.label, route=EXCLUDED.route, sort_order=EXCLUDED.sort_order,
  is_active=true, updated_at=now();

-- 3) SEED доступов role=support
WITH r AS (SELECT id FROM public.roles WHERE code='support'),
allow(section_code,access_level) AS (VALUES
  ('communication','manage'),
  ('deals','manage'),
  ('contacts','manage'),
  ('payments','view'),
  ('forms-hub','view'),
  ('support','manage')
)
INSERT INTO public.role_admin_section_access (role_id, section_id, access_level)
SELECT r.id, s.id, allow.access_level
  FROM r CROSS JOIN allow
  JOIN public.admin_section s ON s.code = allow.section_code
ON CONFLICT (role_id, section_id) DO UPDATE
  SET access_level = EXCLUDED.access_level, updated_at = now();

WITH r AS (SELECT id FROM public.roles WHERE code='support'),
deny_codes(section_code) AS (VALUES
  ('sites'),('editorial'),('live-events'),('marketing'),('roles'),
  ('club-members'),('telegram-invite-audit'),('training'),('documents'),
  ('ai'),('ilex'),('sections'),('products'),('consents'),('integrations')
)
INSERT INTO public.role_admin_section_access (role_id, section_id, access_level)
SELECT r.id, s.id, 'none'
  FROM r CROSS JOIN deny_codes
  JOIN public.admin_section s ON s.code = deny_codes.section_code
ON CONFLICT (role_id, section_id) DO UPDATE
  SET access_level = EXCLUDED.access_level, updated_at = now();

-- 4) Audit запись о seed
INSERT INTO public.audit_logs (action, actor_user_id, actor_type, entity_type, meta)
VALUES (
  'rbac_v3.seed_catalog_and_support_baseline', NULL, 'system', 'admin_section',
  jsonb_build_object(
    'source','migration_D',
    'sections_active',(SELECT count(*) FROM public.admin_section WHERE is_active),
    'resources_active',(SELECT count(*) FROM public.admin_resource WHERE is_active),
    'support_allow',ARRAY['communication','deals','contacts','payments','forms-hub','support'],
    'support_deny',ARRAY['sites','editorial','live-events','marketing','roles',
      'club-members','telegram-invite-audit','training','documents','ai',
      'ilex','sections','products','consents','integrations']
  )
);

-- 5) kill-switch flag (rollback only)
INSERT INTO public.app_settings (key, value)
VALUES ('admin_section_gating_enabled',
  jsonb_build_object('enabled', true, 'rollback_only', true, 'set_at', now()::text))
ON CONFLICT (key) DO NOTHING;
