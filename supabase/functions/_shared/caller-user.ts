import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Validates an explicit user access token without installing it as a global
 * client header. Installing the same Authorization value both globally and as
 * getUser(token) breaks on managed projects that use publishable keys and
 * asymmetric JWT signing keys.
 */
export async function getCallerUserId(
  req: Request,
  logScope = "caller-auth",
): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    console.warn(`[${logScope}] auth_rejected`, { reason: "missing_bearer" });
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    console.warn(`[${logScope}] auth_rejected`, { reason: "empty_bearer" });
    return null;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) {
    console.warn(`[${logScope}] auth_rejected`, { reason: "missing_auth_env" });
    return null;
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    console.warn(`[${logScope}] auth_rejected`, {
      reason: error ? "get_user_failed" : "user_missing",
      status: error?.status ?? null,
    });
    return null;
  }

  return data.user.id;
}
