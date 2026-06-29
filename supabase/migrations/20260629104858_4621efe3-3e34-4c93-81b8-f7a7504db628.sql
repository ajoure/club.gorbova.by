DELETE FROM public.audit_logs
 WHERE action = 'preorder.convert_on_pay'
   AND meta->>'paid_order_id' = '22222222-2222-2222-2222-222222222222';

DELETE FROM public.orders_v2
 WHERE id IN (
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222'
 )
 AND meta->>'synthetic_test' = 'PATCH-PREORDER-CONVERT-AUDIT-FIX-RUNTIME';