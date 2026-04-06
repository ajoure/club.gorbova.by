import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

interface PermissionsData {
  permissions: string[];
  userRoles: Role[];
}

/**
 * usePermissions — canonical permissions hook.
 *
 * B2: Single useQuery flight combining RPC get_user_permissions + user_roles_v2.
 * - One queryKey, one network flight, one cache entry.
 * - staleTime: 5min — no refetch on remount if data is fresh.
 * - refetchOnMount: false when data is fresh.
 * - refetchOnWindowFocus: false — permission graph doesn't need live refresh.
 * - Shell doesn't wait for this; role from AuthContext is enough for initial render.
 */
export function usePermissions() {
  const { user } = useAuth();

  const { data, isLoading: loading } = useQuery<PermissionsData>({
    queryKey: ["user-permissions-and-roles", user?.id],
    queryFn: async (): Promise<PermissionsData> => {
      if (!user?.id) return { permissions: [], userRoles: [] };

      // Single parallel flight for both queries
      const [permsResult, rolesResult] = await Promise.all([
        supabase.rpc("get_user_permissions", { _user_id: user.id }),
        supabase
          .from("user_roles_v2")
          .select(`
            role_id,
            roles:role_id (
              id,
              code,
              name,
              description
            )
          `)
          .eq("user_id", user.id),
      ]);

      const permissions = permsResult.error
        ? (console.error("Error fetching permissions:", permsResult.error), [])
        : (permsResult.data as string[]) || [];

      const userRoles = rolesResult.error
        ? (console.error("Error fetching roles:", rolesResult.error), [])
        : (rolesResult.data
            ?.map((r) => r.roles as unknown as Role)
            .filter(Boolean) || []);

      return { permissions, userRoles };
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const permissions = data?.permissions ?? [];
  const userRoles = data?.userRoles ?? [];

  const hasPermission = useCallback(
    (permissionCode: string): boolean => {
      return permissions.includes(permissionCode);
    },
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (permissionCodes: string[]): boolean => {
      return permissionCodes.some((code) => permissions.includes(code));
    },
    [permissions]
  );

  const hasRole = useCallback(
    (roleCode: string): boolean => {
      return userRoles.some((r) => r.code === roleCode);
    },
    [userRoles]
  );

  const isSuperAdmin = useCallback((): boolean => {
    return hasRole("super_admin");
  }, [hasRole]);

  const isAdmin = useCallback((): boolean => {
    return hasRole("admin") || hasRole("super_admin");
  }, [hasRole]);

  const isViewOnlyRole = useCallback((): boolean => {
    return userRoles.some((r) => 
      r.code.includes('_gost') || 
      r.code.includes('_view') || 
      r.code.includes('_readonly')
    );
  }, [userRoles]);

  const canWrite = useCallback((category: string): boolean => {
    if (hasRole("super_admin")) return true;
    if (isViewOnlyRole()) return false;
    return hasPermission(`${category}.edit`) || 
           hasPermission(`${category}.manage`) ||
           hasPermission(`${category}.delete`) ||
           hasPermission(`${category}.create`);
  }, [hasRole, isViewOnlyRole, hasPermission]);

  const hasAdminAccess = useCallback((): boolean => {
    const adminPermissions = [
      "users.view",
      "users.update",
      "users.block",
      "users.delete",
      "roles.view",
      "roles.manage",
      "admins.manage",
      "content.edit",
      "entitlements.view",
      "entitlements.manage",
      "audit.view",
      "news.view",
      "news.edit",
    ];
    return hasAnyPermission(adminPermissions);
  }, [hasAnyPermission]);

  // refetch by invalidating the query
  const refetch = useCallback(() => {
    // Intentionally not calling refetch directly — consumers should use queryClient.invalidateQueries
  }, []);

  return {
    permissions,
    userRoles,
    loading,
    hasPermission,
    hasAnyPermission,
    hasRole,
    isSuperAdmin,
    isAdmin,
    isViewOnlyRole,
    canWrite,
    hasAdminAccess,
    refetch,
  };
}
