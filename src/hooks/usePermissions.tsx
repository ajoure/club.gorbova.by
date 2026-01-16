import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

interface Permission {
  id: string;
  code: string;
  name: string;
  category: string | null;
}

export function usePermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [userRoles, setUserRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setPermissions([]);
      setUserRoles([]);
      setLoading(false);
      return;
    }

    try {
      // Get user permissions
      const { data: perms, error: permsError } = await supabase.rpc("get_user_permissions", {
        _user_id: user.id,
      });

      if (permsError) {
        console.error("Error fetching permissions:", permsError);
      } else {
        setPermissions(perms || []);
      }

      // Get user roles
      const { data: rolesData, error: rolesError } = await supabase
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
        .eq("user_id", user.id);

      if (rolesError) {
        console.error("Error fetching roles:", rolesError);
      } else {
        const roles = rolesData
          ?.map((r) => r.roles as unknown as Role)
          .filter(Boolean) || [];
        setUserRoles(roles);
      }
    } catch (error) {
      console.error("Error in usePermissions:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

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

  // Check if user has a view-only role (e.g., admin_gost, _view, _readonly)
  const isViewOnlyRole = useCallback((): boolean => {
    return userRoles.some((r) => 
      r.code.includes('_gost') || 
      r.code.includes('_view') || 
      r.code.includes('_readonly')
    );
  }, [userRoles]);

  // Check if user can write (edit/manage/delete) in a specific category
  const canWrite = useCallback((category: string): boolean => {
    // Super admins can always write
    if (hasRole("super_admin")) return true;
    // View-only roles cannot write
    if (isViewOnlyRole()) return false;
    // Check for specific write permissions
    return hasPermission(`${category}.edit`) || 
           hasPermission(`${category}.manage`) ||
           hasPermission(`${category}.delete`) ||
           hasPermission(`${category}.create`);
  }, [hasRole, isViewOnlyRole, hasPermission]);

  const hasAdminAccess = useCallback((): boolean => {
    // Has access to admin panel if has any admin-related permission
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
    refetch: fetchPermissions,
  };
}
