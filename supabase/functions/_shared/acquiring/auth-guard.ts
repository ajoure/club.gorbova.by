// Phase 2 — Shared super_admin auth guard for acquiring/stripe edge functions.
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface AuthorizedUser {
  user_id: string;
  email: string | null;
}

/**
 * Verifies JWT, then checks super_admin role via has_role_v2.
 * Returns { user } on success; throws Error on failure.
 */
export async function requireSuperAdmin(req: Request): Promise<{ user: AuthorizedUser; supabase: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('unauthorized:no_token');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('unauthorized:invalid_token');

  const { data: ok } = await supabase.rpc('has_role_v2', {
    _user_id: user.id,
    _role_code: 'super_admin',
  });
  if (!ok) throw new Error('forbidden:not_super_admin');

  return { user: { user_id: user.id, email: user.email ?? null }, supabase };
}

/**
 * Same as above but returns an authed supabase client (RLS-aware) for actions
 * that must be performed as the actor (e.g. RPCs with SECURITY DEFINER that
 * check auth.uid()).
 */
export function actorSupabase(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
}
