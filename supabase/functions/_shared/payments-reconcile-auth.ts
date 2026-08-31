import { requestHasServiceRoleKey } from './service-request-auth.ts';

export async function authorizePaymentsReconcile(
  req: Request,
  serviceKey: string,
  supabase: { rpc: (name: string) => PromiseLike<{ data: string | null; error: unknown }> },
): Promise<boolean> {
  if (requestHasServiceRoleKey(req, serviceKey)) return true;
  const provided = req.headers.get('x-payments-reconcile-cron-secret') || '';
  if (!provided || provided.length > 256) return false;
  const { data: expected, error } = await supabase.rpc('payments_reconcile_cron_secret');
  if (error || !expected) return false;
  let difference = provided.length ^ expected.length;
  for (let i = 0; i < Math.max(provided.length, expected.length); i++) {
    difference |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return difference === 0;
}
