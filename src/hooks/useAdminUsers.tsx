import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AdminUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  roles: {
    code: string;
    name: string;
  }[];
}

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      // Get profiles with their roles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (profilesError) {
        console.error("Error fetching profiles:", profilesError);
        toast.error("Ошибка загрузки пользователей");
        return;
      }

      // Get all user roles
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles_v2")
        .select(`
          user_id,
          roles:role_id (
            code,
            name
          )
        `);

      if (rolesError) {
        console.error("Error fetching user roles:", rolesError);
      }

      // Map roles to users
      const rolesMap = new Map<string, { code: string; name: string }[]>();
      userRoles?.forEach((ur) => {
        const role = ur.roles as unknown as { code: string; name: string };
        if (role) {
          const existing = rolesMap.get(ur.user_id) || [];
          existing.push(role);
          rolesMap.set(ur.user_id, existing);
        }
      });

      const mappedUsers: AdminUser[] = profiles.map((p) => ({
        user_id: p.user_id,
        email: p.email,
        full_name: p.full_name,
        status: p.status,
        created_at: p.created_at,
        last_seen_at: p.last_seen_at,
        roles: rolesMap.get(p.user_id) || [],
      }));

      setUsers(mappedUsers);
    } catch (error) {
      console.error("Error in useAdminUsers:", error);
      toast.error("Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const invokeUsersAdminActions = useCallback(
    async (body: Record<string, unknown>) => {
      const token = await getAccessToken();
      if (!token) {
        return { data: null, error: new Error("NOT_AUTHENTICATED") } as const;
      }
      return await supabase.functions.invoke("users-admin-actions", {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [getAccessToken]
  );

  const invokeRolesAdmin = useCallback(
    async (body: Record<string, unknown>) => {
      const token = await getAccessToken();
      if (!token) {
        return { data: null, error: new Error("NOT_AUTHENTICATED") } as const;
      }
      return await supabase.functions.invoke("roles-admin", {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [getAccessToken]
  );

  const blockUser = async (userId: string): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({ action: "block", targetUserId: userId });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Block error:", response.error);
        toast.error("Ошибка блокировки");
        return false;
      }

      toast.success("Пользователь заблокирован");
      await fetchUsers();
      return true;
    } catch (error) {
      console.error("Block error:", error);
      toast.error("Ошибка блокировки");
      return false;
    }
  };

  const unblockUser = async (userId: string): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({ action: "unblock", targetUserId: userId });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Unblock error:", response.error);
        toast.error("Ошибка разблокировки");
        return false;
      }

      toast.success("Пользователь разблокирован");
      await fetchUsers();
      return true;
    } catch (error) {
      console.error("Unblock error:", error);
      toast.error("Ошибка разблокировки");
      return false;
    }
  };

  const deleteUser = async (userId: string): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({ action: "delete", targetUserId: userId });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Delete error:", response.error);
        toast.error("Ошибка удаления");
        return false;
      }

      toast.success("Пользователь удален");
      await fetchUsers();
      return true;
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Ошибка удаления");
      return false;
    }
  };

  const restoreUser = async (userId: string): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({ action: "restore", targetUserId: userId });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Restore error:", response.error);
        toast.error("Ошибка восстановления");
        return false;
      }

      toast.success("Пользователь восстановлен");
      await fetchUsers();
      return true;
    } catch (error) {
      console.error("Restore error:", error);
      toast.error("Ошибка восстановления");
      return false;
    }
  };

  const assignRole = async (userId: string, roleCode: string): Promise<boolean> => {
    try {
      const response = await invokeRolesAdmin({ action: "assign_role", userId, roleCode });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Assign role error:", response.error);
        toast.error("Ошибка назначения роли");
        return false;
      }

      if (response.data?.error) {
        const errorMap: Record<string, string> = {
          "Permission denied": "Нет прав для назначения роли",
          "Role not found": "Роль не найдена",
          "User already has this role": "Пользователь уже имеет эту роль",
        };
        toast.error(errorMap[response.data.error] || response.data.error);
        return false;
      }

      toast.success("Роль назначена");
      await fetchUsers();
      return true;
    } catch (error) {
      console.error("Assign role error:", error);
      toast.error("Ошибка назначения роли");
      return false;
    }
  };

  const resetPassword = async (email: string, userId?: string): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({
        action: "reset_password",
        email,
        targetUserId: userId,
      });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Reset password error:", response.error);
        toast.error("Ошибка сброса пароля");
        return false;
      }

      toast.success("Ссылка для сброса пароля отправлена");
      return true;
    } catch (error) {
      console.error("Reset password error:", error);
      toast.error("Ошибка сброса пароля");
      return false;
    }
  };

  const forceLogout = async (userId: string): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({ action: "force_logout", targetUserId: userId });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Force logout error:", response.error);
        toast.error("Ошибка принудительного выхода");
        return false;
      }

      toast.success("Пользователь принудительно вышел");
      return true;
    } catch (error) {
      console.error("Force logout error:", error);
      toast.error("Ошибка принудительного выхода");
      return false;
    }
  };

  const startImpersonation = async (userId: string): Promise<{ tokenHash: string; email: string } | null> => {
    try {
      const response = await invokeUsersAdminActions({ action: "impersonate_start", targetUserId: userId });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return null;
        }
        console.error("Impersonation error:", response.error);
        toast.error("Ошибка входа от имени пользователя");
        return null;
      }

      if (!response.data?.tokenHash || !response.data?.email) {
        console.error("Missing impersonation data:", response.data);
        toast.error("Ошибка: неполные данные для входа");
        return null;
      }

      return { tokenHash: response.data.tokenHash, email: response.data.email };
    } catch (error) {
      console.error("Impersonation error:", error);
      toast.error("Ошибка входа от имени пользователя");
      return null;
    }
  };

  const stopImpersonation = async (): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({ action: "impersonate_stop" });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Stop impersonation error:", response.error);
        toast.error("Ошибка выхода из режима просмотра");
        return false;
      }

      toast.success("Вышли из режима просмотра");
      return true;
    } catch (error) {
      console.error("Stop impersonation error:", error);
      toast.error("Ошибка выхода из режима просмотра");
      return false;
    }
  };

  const changeUserEmail = async (userId: string, newEmail: string): Promise<boolean> => {
    try {
      const response = await invokeUsersAdminActions({
        action: "change_email",
        targetUserId: userId,
        newEmail,
      });

      if (response.error) {
        if (response.error instanceof Error && response.error.message === "NOT_AUTHENTICATED") {
          toast.error("Сессия истекла — войдите снова");
          return false;
        }
        console.error("Change email error:", response.error);
        toast.error("Ошибка смены email");
        return false;
      }

      if (response.data?.error) {
        // Handle specific error messages
        if (response.data.error === "Email already in use") {
          toast.error("Этот email уже используется другим пользователем");
        } else {
          toast.error(response.data.message || response.data.error);
        }
        return false;
      }

      toast.success(`Email изменён на ${newEmail}`);
      await fetchUsers();
      return true;
    } catch (error) {
      console.error("Change email error:", error);
      toast.error("Ошибка смены email");
      return false;
    }
  };

  return {
    users,
    loading,
    refetch: fetchUsers,
    blockUser,
    unblockUser,
    deleteUser,
    restoreUser,
    assignRole,
    resetPassword,
    forceLogout,
    startImpersonation,
    stopImpersonation,
    changeUserEmail,
  };
}
