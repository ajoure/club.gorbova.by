import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  AccessLevel,
  CATEGORY_TO_ADMIN_SECTION,
  permissionGrantedByAdminSections,
} from "@/lib/rbacPermissionFallback";

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

interface AdminAccessRow {
  section_code: string;
  resource_code: string | null;
  access_level: AccessLevel;
  source: string;
}

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 };

/**
 * canWrite category → admin section mapping (RBAC v3).
 * Used so legacy callers like canWrite('deals') resolve via section access
 * for custom roles that don't carry legacy permission codes.
 */
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

  const { data, isLoading: loading } = useQuery<PermissionsData & { adminAccess: AdminAccessRow[] }>({
    queryKey: ["user-permissions-and-roles", user?.id],
    queryFn: async () => {
      if (!user?.id) return { permissions: [], userRoles: [], adminAccess: [] };

      const [permsResult, rolesResult, adminAccessResult] = await Promise.all([
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
        supabase.rpc("get_admin_access", { _user_id: user.id }),
      ]);

      const permissions = permsResult.error
        ? (console.error("Error fetching permissions:", permsResult.error), [])
        : (permsResult.data as string[]) || [];

      const userRoles = rolesResult.error
        ? (console.error("Error fetching roles:", rolesResult.error), [])
        : (rolesResult.data
            ?.map((r) => r.roles as unknown as Role)
            .filter(Boolean) || []);

      const adminAccess = adminAccessResult.error
        ? (console.error("Error fetching admin access:", adminAccessResult.error), [])
        : ((adminAccessResult.data as AdminAccessRow[]) || []);

      return { permissions, userRoles, adminAccess };
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const permissions = useMemo(() => data?.permissions ?? [], [data?.permissions]);
  const userRoles = useMemo(() => data?.userRoles ?? [], [data?.userRoles]);
  const adminAccess = useMemo(() => data?.adminAccess ?? [], [data?.adminAccess]);

  // Section access map (highest level wins, resource overrides ignored here — section gate is enough for canWrite)
  const sectionLevels = useMemo(() => {
    const levels = new Map<string, AccessLevel>();
    for (const row of adminAccess) {
      if (row.resource_code) continue;
      const prev = levels.get(row.section_code) ?? "none";
      if (LEVEL_RANK[row.access_level] > LEVEL_RANK[prev]) {
        levels.set(row.section_code, row.access_level);
      }
    }
    return levels;
  }, [adminAccess]);

  const sectionMeets = useCallback((sectionCode: string, min: AccessLevel): boolean => {
    const have = sectionLevels.get(sectionCode) ?? "none";
    return LEVEL_RANK[have] >= LEVEL_RANK[min];
  }, [sectionLevels]);

  const hasPermission = useCallback(
    (permissionCode: string): boolean => {
      if (permissions.includes(permissionCode)) return true;

      return permissionGrantedByAdminSections(permissionCode, sectionLevels);
    },
    [permissions, sectionLevels]
  );

  const hasAnyPermission = useCallback(
    (permissionCodes: string[]): boolean => {
      return permissionCodes.some((code) => hasPermission(code));
    },
    [hasPermission]
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
    if (hasRole("super_admin") || hasRole("admin")) return true;
    if (isViewOnlyRole()) return false;
    // Legacy permission codes
    if (
      hasPermission(`${category}.edit`) ||
      hasPermission(`${category}.manage`) ||
      hasPermission(`${category}.delete`) ||
      hasPermission(`${category}.create`)
    ) return true;
    // RBAC v3 fallback: category → section, require edit or higher
    const section = CATEGORY_TO_ADMIN_SECTION[category];
    if (section && sectionMeets(section, "edit")) return true;
    return false;
  }, [hasRole, isViewOnlyRole, hasPermission, sectionMeets]);

  const hasAdminAccess = useCallback((): boolean => {
    if (hasRole("super_admin") || hasRole("admin")) return true;
    const adminPermissions = [
      "users.view", "users.update", "users.block", "users.delete",
      "roles.view", "roles.manage", "admins.manage", "content.edit",
      "entitlements.view", "entitlements.manage", "audit.view",
      "news.view", "news.edit",
    ];
    if (hasAnyPermission(adminPermissions)) return true;
    // RBAC v3: any section access at view+ grants admin shell
    return Array.from(sectionLevels.values()).some(
      (level) => LEVEL_RANK[level] >= LEVEL_RANK.view,
    );
  }, [hasRole, hasAnyPermission, sectionLevels]);

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
