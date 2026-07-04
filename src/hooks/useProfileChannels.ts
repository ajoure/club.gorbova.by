import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * useProfileChannels — read-only каналы связи, привязанные к одному profile.id.
 *
 * Не создаёт новых сущностей и не пишет в БД. Показывает только уже
 * существующие связи (V2-CHANNELS P1):
 *   - Telegram: profiles.telegram_user_id IS NOT NULL
 *   - Instagram: instagram_contacts.profile_id = profileId
 *   - Support: support_tickets.profile_id = profileId AND status NOT IN (closed,resolved)
 *
 * Bot-selector Telegram остаётся внутри ContactTelegramChat — здесь только
 * факт «канал Telegram доступен».
 */
export interface ProfileChannels {
  telegram: {
    linked: boolean;
    telegramUserId: number | null;
    telegramUsername: string | null;
  };
  instagram: Array<{
    contactId: string;
    accountId: string;
    instagramUserId: string;
    username: string | null;
    fullName: string | null;
  }>;
  support: Array<{
    ticketId: string;
    ticketNumber: string | null;
    subject: string | null;
    status: string;
    updatedAt: string;
  }>;
}

export function useProfileChannels(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ["profile-channels", profileId],
    enabled: !!profileId,
    staleTime: 60_000,
    queryFn: async (): Promise<ProfileChannels> => {
      const pid = profileId as string;
      const [profileRes, igRes, supportRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, telegram_user_id, telegram_username")
          .eq("id", pid)
          .maybeSingle(),
        supabase
          .from("instagram_contacts")
          .select("id, instagram_account_id, instagram_user_id, instagram_username, full_name")
          .eq("profile_id", pid),
        supabase
          .from("support_tickets")
          .select("id, ticket_number, subject, status, updated_at")
          .eq("profile_id", pid)
          .not("status", "in", "(closed,resolved)")
          .order("updated_at", { ascending: false })
          .limit(20),
      ]);
      if (profileRes.error) throw profileRes.error;
      const tg = profileRes.data;
      return {
        telegram: {
          linked: !!tg?.telegram_user_id,
          telegramUserId: tg?.telegram_user_id ?? null,
          telegramUsername: tg?.telegram_username ?? null,
        },
        instagram: (igRes.data || []).map((c: any) => ({
          contactId: c.id,
          accountId: c.instagram_account_id,
          instagramUserId: c.instagram_user_id,
          username: c.instagram_username ?? null,
          fullName: c.full_name ?? null,
        })),
        support: (supportRes.data || []).map((t: any) => ({
          ticketId: t.id,
          ticketNumber: t.ticket_number ?? null,
          subject: t.subject ?? null,
          status: t.status,
          updatedAt: t.updated_at,
        })),
      };
    },
  });
}
