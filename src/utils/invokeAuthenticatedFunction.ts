import { supabase } from "@/integrations/supabase/client";

/**
 * Invoke a user-facing Edge Function with the current user's JWT explicitly.
 *
 * Supabase's Functions client normally supplies this header automatically, but
 * older/stale client bundles can fall back to the project publishable key. A
 * publishable key is not a user JWT and protected functions reject it with 401.
 */
export async function invokeAuthenticatedFunction<T = unknown>(
  functionName: string,
  body: unknown,
) {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new Error("Сессия истекла. Войдите в аккаунт повторно.");
  }

  return supabase.functions.invoke<T>(functionName, {
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
