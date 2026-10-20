import { requestHasServiceRoleKey } from '../_shared/service-request-auth.ts';
import { verifyLiveBearerClaims, type LiveAuthClaimsResponse } from '../_shared/live-auth-claims.ts';

type Decision = { allowed: true; kind: 'service' | 'staff' }
  | { allowed: false; status: 401 | 403; reason: string };

/** Both opaque managed API keys and signed-in staff use the same fail-closed gate. */
export async function authorizeEmailSender(
  request: Request,
  serviceKey: string,
  verifyClaims: (bearer: string) => Promise<LiveAuthClaimsResponse>,
  canManage: (userId: string) => Promise<boolean>,
): Promise<Decision> {
  if (requestHasServiceRoleKey(request, serviceKey)) return { allowed: true, kind: 'service' };
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) return { allowed: false, status: 401, reason: 'missing_credentials' };
  const verified = await verifyLiveBearerClaims(() => verifyClaims(bearer));
  if (!verified.userId) return { allowed: false, status: 401, reason: 'invalid_credentials' };
  try {
    if (await canManage(verified.userId)) return { allowed: true, kind: 'staff' };
  } catch { /* An unavailable RBAC lookup never opens the sender. */ }
  return { allowed: false, status: 403, reason: 'staff_access_required' };
}
