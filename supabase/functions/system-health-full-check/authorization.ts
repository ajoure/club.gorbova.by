import { requestHasServiceRoleKey } from "../_shared/service-request-auth.ts";

function exactSecret(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < Math.max(provided.length, expected.length); i++) {
    diff |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function authorizeSystemHealth(
  req: Request, serviceKey: string, cronSecret: string | undefined,
  verifyStaff: () => Promise<boolean>,
): Promise<boolean> {
  if (requestHasServiceRoleKey(req, serviceKey) || exactSecret(req.headers.get("x-cron-secret"), cronSecret)) return true;
  if (!req.headers.get("Authorization")?.startsWith("Bearer ")) return false;
  return await verifyStaff();
}
