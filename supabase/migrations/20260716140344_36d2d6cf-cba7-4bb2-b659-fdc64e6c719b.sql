
-- Fix: восстановление доступа к training_lessons через module.product_id + access_rules.
-- Проблема: миграция 20260716095645 требовала training_lessons.product_id IS NOT NULL,
-- но у всех 406 строк product_id = NULL. Все не-админы потеряли доступ ко всем урокам.

CREATE OR REPLACE FUNCTION public.user_has_training_lesson_access(_user_id uuid, _lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.training_lessons tl
    JOIN public.training_modules tm ON tm.id = tl.module_id
    WHERE tl.id = _lesson_id
      AND tl.is_active = true
      AND (
        -- админ / super_admin
        public.has_role_v2(_user_id, 'admin')
        OR public.has_role_v2(_user_id, 'super_admin')
        -- прямой entitlement на продукт модуля
        OR (
          tm.product_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.entitlements e
            WHERE e.user_id = _user_id
              AND e.product_id = tm.product_id
              AND e.status = 'active'
              AND (e.expires_at IS NULL OR e.expires_at > now())
          )
        )
        -- entitlement + access_rule training_content на этот module
        OR EXISTS (
          SELECT 1
          FROM public.access_rules ar
          JOIN public.entitlements e
            ON e.user_id = _user_id
           AND e.product_id = ar.product_id
           AND e.status = 'active'
           AND (e.expires_at IS NULL OR e.expires_at > now())
          WHERE ar.is_active = true
            AND ar.grant_target_type = 'training_content'
            AND (
              -- target_ref = module_id этого урока
              ar.target_ref = tl.module_id::text
              -- либо module_id лежит в allowed_module_ids
              OR (
                ar.conditions ? 'allowed_module_ids'
                AND (ar.conditions->'allowed_module_ids') ? tl.module_id::text
              )
              -- либо full-режим на target_ref = product_id модуля
              OR (
                tm.product_id IS NOT NULL
                AND ar.target_ref = tm.product_id::text
                AND COALESCE(ar.conditions->>'access_mode','full') = 'full'
              )
            )
        )
        -- entitlement + access_rule product_access → доступ к целевому продукту
        OR (
          tm.product_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.access_rules ar
            JOIN public.entitlements e
              ON e.user_id = _user_id
             AND e.product_id = ar.product_id
             AND e.status = 'active'
             AND (e.expires_at IS NULL OR e.expires_at > now())
            WHERE ar.is_active = true
              AND ar.grant_target_type = 'product_access'
              AND ar.target_ref = tm.product_id::text
          )
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_training_lesson_access(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view lessons they are entitled to" ON public.training_lessons;

CREATE POLICY "Users can view lessons they are entitled to"
ON public.training_lessons
FOR SELECT
TO authenticated
USING (public.user_has_training_lesson_access(auth.uid(), id));
