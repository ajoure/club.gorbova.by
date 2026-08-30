type ServiceClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export class SalesManagerSelectionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

/** Resolve and authorize the manager attached to a newly-created link/deal. */
export async function resolveSalesManagerForCreation(
  admin: ServiceClient,
  actorUserId: string,
  requestedUserId?: string | null,
): Promise<string> {
  const responsibleUserId = requestedUserId || actorUserId;
  const [staff, assignSelf, reassign] = await Promise.all([
    admin.rpc('has_role_v2', { _user_id: responsibleUserId, _role_code: 'employee' }),
    admin.rpc('has_permission', { _user_id: actorUserId, _permission_code: 'deals.assign_self' }),
    admin.rpc('has_permission', { _user_id: actorUserId, _permission_code: 'deals.reassign' }),
  ]);

  if (staff.error || assignSelf.error || reassign.error) {
    throw new SalesManagerSelectionError('sales_manager_rbac_check_failed', 500);
  }
  if (staff.data !== true) {
    throw new SalesManagerSelectionError('responsible_user_not_staff', 400);
  }
  if (responsibleUserId === actorUserId && assignSelf.data !== true && reassign.data !== true) {
    throw new SalesManagerSelectionError('forbidden_assign_self', 403);
  }
  if (responsibleUserId !== actorUserId && reassign.data !== true) {
    throw new SalesManagerSelectionError('forbidden_assign_other', 403);
  }
  return responsibleUserId;
}
