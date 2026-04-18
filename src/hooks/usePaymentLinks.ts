import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PaymentLinkRow {
  id: string;
  url_token: string;
  product_id: string | null;
  tariff_id: string | null;
  offer_id: string | null;
  amount: number;
  currency: string;
  payment_type: string;
  description: string | null;
  user_id: string | null;
  status: string;
  max_uses: number | null;
  current_uses: number;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  product_name: string | null;
  tariff_name: string | null;
  offer_title: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  creator_name: string | null;
  creator_email: string | null;
  is_expired: boolean;
  is_exhausted: boolean;
  is_invalid: boolean;
  related_orders_count: number;
  paid_orders_count: number;
  last_order_id: string | null;
}

export function usePaymentLinks() {
  return useQuery({
    queryKey: ["payment-links-enriched"],
    queryFn: async (): Promise<PaymentLinkRow[]> => {
      const { data, error } = await supabase
        .from("payment_links_enriched_v" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data as unknown as PaymentLinkRow[]) || [];
    },
    staleTime: 30_000,
  });
}
