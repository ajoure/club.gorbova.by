import { getReturnFence, hasWebLocks, withAuthLease, type AuthLease } from "./impersonationStorage";

/** Ordinary auth is unchanged without a return fence; during return every explicit mutation shares its lock. */
export async function guardedAuthMutation<T>(kind: "password-login" | "other", work: (lease?: AuthLease) => Promise<T>): Promise<T> {
  const run = (lease?: AuthLease) => {
    const fence = getReturnFence();
    if (fence && !(kind === "password-login" && fence.phase === "manual")) throw new Error("RETURN_RECOVERY_REQUIRED");
    return work(lease);
  };
  if (hasWebLocks()) return withAuthLease(run);
  if (getReturnFence()) throw new Error("RETURN_LOCK_UNAVAILABLE");
  return run();
}
