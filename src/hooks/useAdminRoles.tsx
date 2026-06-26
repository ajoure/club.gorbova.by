import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * RBAC v3 canonical hook.
 * Источник правды для UI ролей/сотрудников.
 * Legacy таблицы permissions / role_permissions больше НЕ читаются и НЕ пишутся.
 * Доступы (section / resource access) управляются через RoleAccessEditor → roles-admin edge-функции.
 */

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
}

// Permissions массив сохранён как пустой для обратной совместимости с местами,
// где роль ещё типизирована как RoleWithPermissions. Реальный источник прав — RBAC v3.
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
  const [loading, setLoading] = useState(true);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rolesData, error: rolesError } = await supabase
        .from("roles")
        .select("*")
        .order("created_at", { ascending: true });

      if (rolesError) {
        console.error("Error fetching roles:", rolesError);
        toast.error("Ошибка загрузки ролей");
        return;
      }

      const rolesWithPerms: RoleWithPermissions[] = (rolesData || []).map((r) => ({
        ...r,
        permissions: [],
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
        toast.error(response.error.message || "Ошибка назначения роли");
        return false;
      }

      if (response.data?.error) {
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
        toast.error(response.error.message || "Ошибка удаления роли");
        return false;
      }

      if (response.data?.error) {
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
  ): Promise<string | null> => {
    try {
      const response = await supabase.functions.invoke("roles-admin", {
        body: { action: "create_role", roleCode: code, roleName: name, roleDescription: description },
      });

      if (response.error) {
        console.error("Create role error:", response.error);
        toast.error("Ошибка создания роли");
        return null;
      }

      if (response.data?.error) {
        toast.error(response.data.error);
        return null;
      }

      toast.success("Роль создана");
      const roleId = response.data?.role?.id ?? null;
      await fetchRoles();
      return roleId;
    } catch (error) {
      console.error("Create role error:", error);
      toast.error("Ошибка создания роли");
      return null;
    }
  };

  const deleteRole = async (roleId: string): Promise<boolean> => {
    try {
      const response = await supabase.functions.invoke("roles-admin", {
        body: { action: "delete_role", roleId },
      });

      if (response.error) {
        console.error("Delete role error:", response.error);
        toast.error("Ошибка удаления роли");
        return false;
      }

      if (response.data?.error) {
        const errorMap: Record<string, string> = {
          "Cannot delete system role": "Нельзя удалить системную роль",
          "Role is assigned to users. Remove role from all users first.":
            "Роль назначена пользователям. Сначала снимите роль со всех.",
          "Role not found": "Роль не найдена",
          "Permission denied": "Нет прав для удаления роли",
        };
        toast.error(errorMap[response.data.error] || response.data.error);
        return false;
      }

      toast.success("Роль удалена");
      await fetchRoles();
      return true;
    } catch (error) {
      console.error("Delete role error:", error);
      toast.error("Ошибка удаления роли");
      return false;
    }
  };

  return {
    roles,
    loading,
    refetch: fetchRoles,
    assignRole,
    removeRole,
    createRole,
    deleteRole,
  };
}
