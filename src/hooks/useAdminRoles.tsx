import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface Permission {
  id: string;
  code: string;
  name: string;
  category: string | null;
}

interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

export function useAdminRoles() {
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      // Get all roles
      const { data: rolesData, error: rolesError } = await supabase
        .from("roles")
        .select("*")
        .order("created_at", { ascending: true });

      if (rolesError) {
        console.error("Error fetching roles:", rolesError);
        toast.error("Ошибка загрузки ролей");
        return;
      }

      // Get all permissions
      const { data: permissionsData, error: permsError } = await supabase
        .from("permissions")
        .select("*")
        .order("category", { ascending: true });

      if (permsError) {
        console.error("Error fetching permissions:", permsError);
      } else {
        setAllPermissions(permissionsData || []);
      }

      // Get role_permissions
      const { data: rolePerms, error: rolePermsError } = await supabase
        .from("role_permissions")
        .select(`
          role_id,
          permission_id,
          permissions:permission_id (
            id,
            code,
            name,
            category
          )
        `);

      if (rolePermsError) {
        console.error("Error fetching role permissions:", rolePermsError);
      }

      // Map permissions to roles
      const permsMap = new Map<string, Permission[]>();
      rolePerms?.forEach((rp) => {
        const perm = rp.permissions as unknown as Permission;
        if (perm) {
          const existing = permsMap.get(rp.role_id) || [];
          existing.push(perm);
          permsMap.set(rp.role_id, existing);
        }
      });

      const rolesWithPerms: RoleWithPermissions[] = rolesData.map((r) => ({
        ...r,
        permissions: permsMap.get(r.id) || [],
      }));

      setRoles(rolesWithPerms);
    } catch (error) {
      console.error("Error in useAdminRoles:", error);
      toast.error("Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const assignRole = async (userId: string, roleCode: string): Promise<boolean> => {
    try {
      const response = await supabase.functions.invoke("roles-admin", {
        body: { action: "assign_role", userId, roleCode },
      });

      if (response.error) {
        console.error("Assign role error:", response.error);
        const errorMessage = response.error.message || "Ошибка назначения роли";
        toast.error(errorMessage);
        return false;
      }

      // Check for application-level errors in the response data
      if (response.data?.error) {
        console.error("Assign role error:", response.data.error);
        const errorMap: Record<string, string> = {
          "Permission denied": "Нет прав для назначения роли",
          "Role not found": "Роль не найдена",
          "User already has this role": "Пользователь уже имеет эту роль",
          "Unauthorized": "Не авторизован",
          "Only super admin can assign super admin role": "Только Владелец может назначать эту роль",
          "SELF_ROLE_CHANGE_FORBIDDEN": "Нельзя изменить свою собственную роль",
          "LAST_OWNER_PROTECTED": "Нельзя убрать роль «Владелец» у последнего владельца системы",
        };
        toast.error(errorMap[response.data.error] || response.data.error);
        return false;
      }

      toast.success("Роль назначена");
      return true;
    } catch (error) {
      console.error("Assign role error:", error);
      toast.error("Ошибка назначения роли");
      return false;
    }
  };

  const removeRole = async (userId: string, roleCode: string): Promise<boolean> => {
    try {
      const response = await supabase.functions.invoke("roles-admin", {
        body: { action: "remove_role", userId, roleCode },
      });

      if (response.error) {
        console.error("Remove role error:", response.error);
        const errorMessage = response.error.message || "Ошибка удаления роли";
        toast.error(errorMessage);
        return false;
      }

      // Check for application-level errors
      if (response.data?.error) {
        console.error("Remove role error:", response.data.error);
        const errorMap: Record<string, string> = {
          "Permission denied": "Нет прав для удаления роли",
          "Role not found": "Роль не найдена",
          "Unauthorized": "Не авторизован",
          "Only super admin can remove super admin role": "Только Владелец может удалять эту роль",
          "SELF_ROLE_CHANGE_FORBIDDEN": "Нельзя изменить свою собственную роль",
          "LAST_OWNER_PROTECTED": "Нельзя убрать роль «Владелец» у последнего владельца системы",
        };
        toast.error(errorMap[response.data.error] || response.data.error);
        return false;
      }

      toast.success("Роль удалена");
      return true;
    } catch (error) {
      console.error("Remove role error:", error);
      toast.error("Ошибка удаления роли");
      return false;
    }
  };

  const createRole = async (
    code: string,
    name: string,
    description?: string
  ): Promise<boolean> => {
    try {
      const response = await supabase.functions.invoke("roles-admin", {
        body: { action: "create_role", roleCode: code, roleName: name, roleDescription: description },
      });

      if (response.error) {
        console.error("Create role error:", response.error);
        toast.error("Ошибка создания роли");
        return false;
      }

      toast.success("Роль создана");
      await fetchRoles();
      return true;
    } catch (error) {
      console.error("Create role error:", error);
      toast.error("Ошибка создания роли");
      return false;
    }
  };

  const setRolePermissions = async (
    roleId: string,
    permissionCodes: string[]
  ): Promise<boolean> => {
    try {
      const response = await supabase.functions.invoke("roles-admin", {
        body: { action: "set_role_permissions", roleId, permissionCodes },
      });

      if (response.error) {
        console.error("Set role permissions error:", response.error);
        toast.error("Ошибка обновления прав");
        return false;
      }

      toast.success("Права обновлены");
      await fetchRoles();
      return true;
    } catch (error) {
      console.error("Set role permissions error:", error);
      toast.error("Ошибка обновления прав");
      return false;
    }
  };

  return {
    roles,
    allPermissions,
    loading,
    refetch: fetchRoles,
    assignRole,
    removeRole,
    createRole,
    setRolePermissions,
  };
}
