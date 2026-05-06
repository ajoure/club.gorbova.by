-- Backup + delete битого entitlement Шуляк Дианы (expires_at IS NULL, source='admin_edit')
-- Создан старым прямым EditDealDialog writer-path (запрещён в PATCH 3).

CREATE TABLE IF NOT EXISTS public._backup_entitlement_delete_byn_2026_05_shulyak (
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  id uuid,
  user_id uuid,
  profile_id uuid,
  product_id uuid,
  product_code text,
  status text,
  expires_at timestamptz,
  order_id uuid,
  meta jsonb,
  created_at timestamptz
);

INSERT INTO public._backup_entitlement_delete_byn_2026_05_shulyak
  (id, user_id, profile_id, product_id, product_code, status, expires_at, order_id, meta, created_at)
SELECT id, user_id, profile_id, product_id, product_code, status, expires_at, order_id, meta, created_at
FROM public.entitlements
WHERE id = 'd7081960-0066-463d-8d39-515ff83a47ec'
  AND user_id = '80afcb07-3d07-40b8-aff7-c17e179e39f5'
  AND product_id = '73c29914-63a3-4f4f-ac42-9f5287e58696'
  AND expires_at IS NULL;

INSERT INTO public.audit_logs (action, actor_type, target_user_id, meta)
SELECT
  'entitlement.deleted.broken_admin_edit_no_expires_at',
  'system',
  '80afcb07-3d07-40b8-aff7-c17e179e39f5',
  jsonb_build_object(
    'entitlement_id', 'd7081960-0066-463d-8d39-515ff83a47ec',
    'product_id', '73c29914-63a3-4f4f-ac42-9f5287e58696',
    'order_id', 'd5aca9de-218a-416a-9c9d-b35f9dbaf899',
    'reason', 'Битый entitlement, созданный прямым EditDealDialog writer-path до PATCH 3. expires_at IS NULL. Будет перевыдан канонически через grant-access-for-order.',
    'backup_table', '_backup_entitlement_delete_byn_2026_05_shulyak'
  )
WHERE EXISTS (
  SELECT 1 FROM public._backup_entitlement_delete_byn_2026_05_shulyak
  WHERE id = 'd7081960-0066-463d-8d39-515ff83a47ec'
);

DELETE FROM public.entitlements
WHERE id = 'd7081960-0066-463d-8d39-515ff83a47ec'
  AND user_id = '80afcb07-3d07-40b8-aff7-c17e179e39f5'
  AND product_id = '73c29914-63a3-4f4f-ac42-9f5287e58696'
  AND expires_at IS NULL;