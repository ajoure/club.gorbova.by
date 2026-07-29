/**
 * Authenticate an internal Edge Function request with the exact managed
 * service key.
 *
 * Supabase's current `sb_secret_*` keys are API keys, not user JWTs. The
 * supabase-js Functions client sends them in `apikey`; older callers in this
 * repository may still send the same exact key as a Bearer credential. Both
 * forms are accepted here, but only after constant-time comparison with the
 * server-side environment value.
 */

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

export function requestHasServiceRoleKey(
  req: Request,
  serviceRoleKey: string,
): boolean {
  if (!serviceRoleKey) return false;

  const apiKey = (req.headers.get("apikey") ?? "").trim();
  if (apiKey && constantTimeEqual(apiKey, serviceRoleKey)) return true;

  const authorization = req.headers.get("Authorization") ??
    req.headers.get("authorization") ??
    "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;

  const bearerToken = authorization.slice(7).trim();
  return !!bearerToken && constantTimeEqual(bearerToken, serviceRoleKey);
}
