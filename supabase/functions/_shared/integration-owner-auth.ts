type AuthClient = {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
};

/** Configuration calls require a verified owner, never a JWT role claim.
 * Internal sync jobs opt in to the existing exact server credential path.
 */
export async function integrationOwnerDenial(
  req: Request,
  client: AuthClient,
  internalServiceKey?: string,
): Promise<{ status: 401 | 403; error: string } | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!match) return { status: 401, error: 'Unauthorized' };
  const token = match[1];
  if (internalServiceKey && token === internalServiceKey) return null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return { status: 401, error: 'Unauthorized' };
    const role = await client.rpc('has_role_v2', {
      _user_id: data.user.id,
      _role_code: 'super_admin',
    });
    if (role.error || role.data !== true) return { status: 403, error: 'Superadmin access required' };
    return null;
  } catch {
    return { status: 403, error: 'Authorization unavailable' };
  }
}
