import { operationalSupabase } from "@/integrations/supabase/operational-client";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdminInfo {
  telegram_user_id: number;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_username: string | null;
  full_name: string | null;
  role: "creator" | "administrator";
  has_active_access: boolean;
  is_bot: boolean;
}

/**
 * Загружает администраторов клуба из telegram_club_members
 * + ботов, привязанных к клубу через telegram_clubs.bot_id → telegram_bots
 */
export function useClubAdmins(clubId: string | null) {
  return useQuery({
    queryKey: ["club-admins", clubId],
    enabled: !!clubId,
    staleTime: 60_000,
    queryFn: async (): Promise<AdminInfo[]> => {
      if (!clubId) return [];

      // 1. Fetch human admins from telegram_club_members
      const { data, error } = await supabase
        .from("telegram_club_members")
        .select("telegram_user_id, telegram_first_name, telegram_last_name, telegram_username, profile_id, last_telegram_check_result")
        .eq("club_id", clubId)
        .or("last_telegram_check_result.cs.{\"chat\":{\"status\":\"administrator\"}},last_telegram_check_result.cs.{\"chat\":{\"status\":\"creator\"}},last_telegram_check_result.cs.{\"channel\":{\"status\":\"administrator\"}},last_telegram_check_result.cs.{\"channel\":{\"status\":\"creator\"}}");

      if (error) {
        console.error("[useClubAdmins] error:", error);
        return [];
      }

      const memberAdmins = data ?? [];

      // Collect profile_ids to check access
      const profileIds = memberAdmins
        .map((m: any) => m.profile_id)
        .filter(Boolean) as string[];

      let accessMap: Record<string, boolean> = {};
      if (profileIds.length > 0) {
        const now = new Date().toISOString();
        const { data: grants } = await supabase
          .from("telegram_access_grants")
          .select("user_id")
          .eq("club_id", clubId)
          .eq("status", "active")
          .gt("end_at", now)
          .in("user_id", profileIds);

        if (grants) {
          for (const g of grants) {
            accessMap[g.user_id] = true;
          }
        }
      }

      const existingTgIds = new Set(memberAdmins.map((m: any) => m.telegram_user_id));

      const result: AdminInfo[] = memberAdmins.map((m: any) => {
        const r = m.last_telegram_check_result as Record<string, any> | null;
        const chatStatus = r?.chat?.status;
        const channelStatus = r?.channel?.status;
        const role: "creator" | "administrator" =
          chatStatus === "creator" || channelStatus === "creator"
            ? "creator"
            : "administrator";

        const firstName = m.telegram_first_name || "";
        const lastName = m.telegram_last_name || "";
        const is_bot =
          firstName.toLowerCase().includes("bot") ||
          lastName.toLowerCase().includes("bot") ||
          (m.telegram_username || "").toLowerCase().includes("bot");

        return {
          telegram_user_id: m.telegram_user_id,
          telegram_first_name: m.telegram_first_name,
          telegram_last_name: m.telegram_last_name,
          telegram_username: m.telegram_username,
          full_name: [firstName, lastName].filter(Boolean).join(" ") || null,
          role,
          has_active_access: m.profile_id ? !!accessMap[m.profile_id] : false,
          is_bot,
        };
      });

      // 2. Fetch bot linked to this club via telegram_clubs.bot_id → telegram_bots
      const { data: clubRow } = await supabase
        .from("telegram_clubs")
        .select("bot_id")
        .eq("id", clubId)
        .single();

      if (clubRow?.bot_id) {
        const { data: bot } = await operationalSupabase
          .rpc("list_operational_telegram_bots")
          .select("bot_id, bot_name, bot_username")
          .eq("id", clubRow.bot_id)
          .single();

        if (bot?.bot_id && !existingTgIds.has(bot.bot_id)) {
          result.push({
            telegram_user_id: bot.bot_id,
            telegram_first_name: bot.bot_name || null,
            telegram_last_name: null,
            telegram_username: bot.bot_username || null,
            full_name: bot.bot_name || bot.bot_username || null,
            role: "administrator",
            has_active_access: false,
            is_bot: true,
          });
        }
      }

      return result;
    },
  });
}
