import { requestHasServiceRoleKey } from "../_shared/service-request-auth.ts";

export type QueueCronAuthorization =
  | { ok: true; mode: "service_role" | "cron_secret" }
  | { ok: false; status: 401; error: "unauthorized" };

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

/**
 * The queue worker mutates payments, orders and access. Only a managed
 * service-role caller or the exact server-side cron secret may start it.
 * User JWTs are intentionally not accepted here; admin recovery goes through
 * the separately authorised remediation surface.
 */
export function authorizeQueueCronRequest(
  req: Request,
  secrets: { serviceRoleKey: string; cronSecret: string },
): QueueCronAuthorization {
  if (requestHasServiceRoleKey(req, secrets.serviceRoleKey)) {
    return { ok: true, mode: "service_role" };
  }

  if (secrets.cronSecret) {
    const explicitSecret = (
      req.headers.get("x-cron-secret") ||
      req.headers.get("x-internal-key") ||
      ""
    ).trim();
    if (
      explicitSecret &&
      constantTimeEqual(explicitSecret, secrets.cronSecret)
    ) {
      return { ok: true, mode: "cron_secret" };
    }

    const authorization = req.headers.get("authorization") || "";
    if (authorization.toLowerCase().startsWith("bearer ")) {
      const bearer = authorization.slice(7).trim();
      if (bearer && constantTimeEqual(bearer, secrets.cronSecret)) {
        return { ok: true, mode: "cron_secret" };
      }
    }
  }

  return { ok: false, status: 401, error: "unauthorized" };
}
