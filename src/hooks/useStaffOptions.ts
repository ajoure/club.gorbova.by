import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StaffOption {
  user_id: string;
  label: string;
  email: string | null;
  telegram_linked: boolean;
}

/**
 * Lightweight list of staff members that can be assigned tasks.
 * Returns profiles having at least one of: employee | admin | super_admin role.
 * Falls back to all profiles if role-join is restricted by RLS.
 *
 * telegram_linked = profiles.telegram_link_status === 'active' — отражает,
 * получит ли сотрудник CRM-уведомление о задаче в Telegram. Источник —
 * существующее поле в profiles (см. TelegramLinkReminder).
 */
export function useStaffOptions() {
  return useQuery({
    queryKey: ["staff-options"],
    queryFn: async (): Promise<StaffOption[]> => {
      const mapProfile = (p: any): StaffOption => ({
        user_id: p.user_id,
        label: p.full_name || p.email || p.user_id,
        email: p.email ?? null,
        telegram_linked: p.telegram_link_status === "active",
      });

      // 1) try role-filtered list
      try {
        const { data: roleRows, error: rolesErr } = await supabase
          .from("user_roles_v2")
          .select("user_id, roles:role_id(code)");
        if (!rolesErr && roleRows) {
          const staffIds = new Set<string>();
          roleRows.forEach((r: any) => {
            const code = r.roles?.code;
            if (code === "employee" || code === "admin" || code === "super_admin") {
              if (r.user_id) staffIds.add(r.user_id);
            }
          });
          if (staffIds.size > 0) {
            const { data: profiles } = await supabase
              .from("profiles")
              .select("user_id, full_name, email, telegram_link_status")
              .in("user_id", Array.from(staffIds))
              .order("full_name", { ascending: true });
            return (profiles ?? []).map(mapProfile);
          }
        }
      } catch {
        // ignore – fallback below
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, telegram_link_status")
        .not("user_id", "is", null)
        .order("full_name", { ascending: true })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map(mapProfile);
    },
    staleTime: 5 * 60 * 1000,
  });
}
