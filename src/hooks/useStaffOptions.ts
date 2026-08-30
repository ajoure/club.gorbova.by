import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StaffOption {
  user_id: string;
  label: string;
  email: string | null;
  telegram_linked: boolean;
}

/**
 * Список сотрудников, которых можно назначать на CRM-задачи.
 * В staff-пул попадают все пользователи, у которых в user_roles_v2 есть
 * хотя бы одна роль с кодом ≠ 'user' (т.е. любая роль, дающая доступ к
 * панели управления). Если у человека есть комбинация ролей `user + staff`,
 * он также считается сотрудником. Чистые клиенты (только `user`) не попадают.
 *
 * telegram_linked = profiles.telegram_link_status === 'active' — отражает,
 * получит ли сотрудник CRM-уведомление о задаче в Telegram.
 */
export function useStaffOptions(enabled = true) {
  return useQuery({
    queryKey: ["staff-options", "v2-any-non-user-role"],
    queryFn: async (): Promise<StaffOption[]> => {
      const mapProfile = (p: any): StaffOption => ({
        user_id: p.user_id,
        label: p.full_name || p.email || p.user_id,
        email: p.email ?? null,
        telegram_linked: p.telegram_link_status === "active",
      });

      const { data: roleRows, error: rolesErr } = await supabase
        .from("user_roles_v2")
        .select("user_id, roles:role_id(code)");
      if (rolesErr) throw rolesErr;

      const staffIds = new Set<string>();
      (roleRows ?? []).forEach((r: any) => {
        const code = r.roles?.code;
        if (!code || code === "user") return;
        if (r.user_id) staffIds.add(r.user_id);
      });

      if (staffIds.size === 0) return [];

      const { data: profiles, error: profErr } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, telegram_link_status")
        .in("user_id", Array.from(staffIds))
        .order("full_name", { ascending: true });
      if (profErr) throw profErr;
      return (profiles ?? []).map(mapProfile);
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
