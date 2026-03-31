import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getProductName } from "@/lib/product-names";

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
  group?: string;
}

export function useAvailableEntitlements() {
  return useQuery({
    queryKey: ["access-rule-entitlements"],
    queryFn: async () => {
      // Get entitlements with product_id for name resolution
      const { data, error } = await supabase
        .from("entitlements")
        .select("product_code, product_id")
        .not("product_code", "is", null)
        .order("product_code");
      if (error) throw error;

      // Get all products for name resolution
      const { data: products } = await supabase
        .from("products_v2")
        .select("id, name");

      const productNameMap = new Map<string, string>();
      (products || []).forEach(p => productNameMap.set(p.id, p.name));

      // Deduplicate
      const seen = new Set<string>();
      const result: EntitlementOption[] = [];
      (data || []).forEach((row: any) => {
        if (row.product_code && !seen.has(row.product_code)) {
          seen.add(row.product_code);
          // Priority: products_v2.name (via product_id) → getProductName(code) → raw code
          const productName = row.product_id ? productNameMap.get(row.product_id) : null;
          const humanLabel = productName || getProductName(row.product_code);
          result.push({
            product_code: row.product_code,
            label: humanLabel,
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
