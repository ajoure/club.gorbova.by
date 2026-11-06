import type { SupabaseClient } from "@supabase/supabase-js";
import { guardedAuthMutation } from "./guardedAuthMutation";
import { runOwnedAuthMutation, type AuthLease } from "./impersonationStorage";

type Auth = SupabaseClient["auth"];
/** Explicit application ingress, not a monkeypatch or a replacement for SDK internal coordination.
 * Supported clients serialize from dispatch through actual settle, even BEFORE any return fence.
 * Old/unwrapped documents can still write; return additionally detects drift and revokes only its captured JWT.
 */
export function createAuthMutationFacade(auth: Auth) {
  const invoke = <T>(kind: "password-login" | "other", lease: AuthLease | undefined, work: () => Promise<T>) =>
    lease ? runOwnedAuthMutation(lease, work)
      : guardedAuthMutation(kind, owned => owned ? runOwnedAuthMutation(owned, work) : work());
  return {
    signInWithPassword: (args: Parameters<Auth["signInWithPassword"]>[0], lease?: AuthLease) => invoke("password-login", lease, () => auth.signInWithPassword(args)),
    signUp: (args: Parameters<Auth["signUp"]>[0], lease?: AuthLease) => invoke("other", lease, () => auth.signUp(args)),
    verifyOtp: (args: Parameters<Auth["verifyOtp"]>[0], lease?: AuthLease) => invoke("other", lease, () => auth.verifyOtp(args)),
    updateUser: (args: Parameters<Auth["updateUser"]>[0], lease?: AuthLease) => invoke("other", lease, () => auth.updateUser(args)),
    signOut: (args?: Parameters<Auth["signOut"]>[0], lease?: AuthLease) => invoke("other", lease, () => args === undefined ? auth.signOut() : auth.signOut(args)),
    setSession: (args: Parameters<Auth["setSession"]>[0], lease: AuthLease) => runOwnedAuthMutation(lease, () => auth.setSession(args)),
    revokeCaptured: (exactVerifiedJwt: string, lease: AuthLease) => runOwnedAuthMutation(lease, () => auth.admin.signOut(exactVerifiedJwt, "local")),
  };
}
