import { supabase } from "@/integrations/supabase/client";
import { createAuthMutationFacade } from "./authMutationFacade";

/** Resolve lazily so there is no second client, initialization change, SDK method mutation or hidden bypass flag. */
export const authMutations = {
  signInWithPassword: (...args: Parameters<ReturnType<typeof createAuthMutationFacade>["signInWithPassword"]>) => createAuthMutationFacade(supabase.auth).signInWithPassword(...args),
  signUp: (...args: Parameters<ReturnType<typeof createAuthMutationFacade>["signUp"]>) => createAuthMutationFacade(supabase.auth).signUp(...args),
  verifyOtp: (...args: Parameters<ReturnType<typeof createAuthMutationFacade>["verifyOtp"]>) => createAuthMutationFacade(supabase.auth).verifyOtp(...args),
  updateUser: (...args: Parameters<ReturnType<typeof createAuthMutationFacade>["updateUser"]>) => createAuthMutationFacade(supabase.auth).updateUser(...args),
  signOut: (...args: Parameters<ReturnType<typeof createAuthMutationFacade>["signOut"]>) => createAuthMutationFacade(supabase.auth).signOut(...args),
};
