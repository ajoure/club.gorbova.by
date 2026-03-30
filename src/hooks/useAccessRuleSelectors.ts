import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// === Telegram Clubs ===
export interface ClubOption {
  id: string;
  club_name: string;
  chat_id: number | null;
  channel_id: number | null;
  access_mode: string | null;
  is_active: boolean;
}

export function useAvailableClubs() {
  return useQuery({
    queryKey: ["access-rule-clubs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_clubs")
        .select("id, club_name, chat_id, channel_id, access_mode, is_active")
        .eq("is_active", true)
        .order("club_name");
      if (error) throw error;
      return (data || []) as ClubOption[];
    },
  });
}

export function getClubAccessLabel(club: ClubOption): string {
  const hasChat = !!club.chat_id;
  const hasChannel = !!club.channel_id;
  if (hasChat && hasChannel) return "чат + канал";
  if (hasChat) return "чат";
  if (hasChannel) return "канал";
  return "—";
}

// === Products ===
export interface ProductOption {
  id: string;
  name: string;
  code: string;
}

export function useAvailableProducts() {
  return useQuery({
    queryKey: ["access-rule-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as ProductOption[];
    },
  });
}

// === Entitlements (unique product_codes) ===
export interface EntitlementOption {
  product_code: string;
  label: string;
}

export function useAvailableEntitlements() {
  return useQuery({
    queryKey: ["access-rule-entitlements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entitlements")
        .select("product_code")
        .not("product_code", "is", null)
        .order("product_code");
      if (error) throw error;

      // Deduplicate
      const seen = new Set<string>();
      const result: EntitlementOption[] = [];
      (data || []).forEach((row: any) => {
        if (row.product_code && !seen.has(row.product_code)) {
          seen.add(row.product_code);
          result.push({
            product_code: row.product_code,
            label: row.product_code,
          });
        }
      });
      return result;
    },
  });
}

// === Tariff access_days for duration defaults ===
export interface TariffDuration {
  id: string;
  name: string;
  access_days: number | null;
}

export function useTariffDurations(productId?: string) {
  return useQuery({
    queryKey: ["tariff-durations", productId],
    queryFn: async () => {
      if (!productId) return [];
      const { data, error } = await supabase
        .from("tariffs")
        .select("id, name, access_days")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as TariffDuration[];
    },
    enabled: !!productId,
  });
}
