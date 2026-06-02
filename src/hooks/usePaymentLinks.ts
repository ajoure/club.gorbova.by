import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  public_url: string | null;
  // Phase 1 Stripe Integration — provider columns exposed via enriched view
  provider: string | null;
  provider_mode: string | null;
  account_code: string | null;
  profile_code: string | null;
  business_stream: string | null;
}

const PAYMENT_LINKS_QUERY_KEY = ["payment-links-enriched"] as const;
const FULL_SYNC_MAX_AGE_MS = 5 * 60 * 1000;

async function fetchAllPaymentLinks(): Promise<PaymentLinkRow[]> {
  const { data, error } = await supabase.rpc(
    "get_admin_payment_links_v1" as never,
    { p_since: null, p_limit: 1000 } as never
  );

  if (error) throw error;
  return (data as unknown as PaymentLinkRow[]) || [];
}

async function fetchPaymentLinksDelta(since: string): Promise<PaymentLinkRow[]> {
  const { data, error } = await supabase.rpc(
    "get_admin_payment_links_v1" as never,
    { p_since: since, p_limit: 1000 } as never
  );

  if (error) throw error;
  return (data as unknown as PaymentLinkRow[]) || [];
}

function mergePaymentLinks(current: PaymentLinkRow[], incoming: PaymentLinkRow[]) {
  if (incoming.length === 0) return current;

  const merged = new Map(current.map((row) => [row.id, row]));
  incoming.forEach((row) => merged.set(row.id, row));

  return Array.from(merged.values()).sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function usePaymentLinks() {
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  const queryKey = [...PAYMENT_LINKS_QUERY_KEY, user?.id ?? "guest"] as const;

  return useQuery({
    queryKey,
    queryFn: async (): Promise<PaymentLinkRow[]> => {
      const cached = queryClient.getQueryData<PaymentLinkRow[]>(queryKey);
      const queryState = queryClient.getQueryState<PaymentLinkRow[]>(queryKey);

      const shouldRunFullSync =
        !cached?.length ||
        !queryState?.dataUpdatedAt ||
        Date.now() - queryState.dataUpdatedAt > FULL_SYNC_MAX_AGE_MS;

      if (shouldRunFullSync) {
        return fetchAllPaymentLinks();
      }

      const lastUpdatedAt = cached.reduce(
        (max, row) => (row.updated_at > max ? row.updated_at : max),
        cached[0]?.updated_at ?? new Date(0).toISOString()
      );

      const delta = await fetchPaymentLinksDelta(lastUpdatedAt);
      return mergePaymentLinks(cached, delta);
    },
    enabled: !loading && !!user,
    placeholderData: (previousData) => previousData,
    refetchInterval: !loading && user ? 15_000 : false,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 30_000,
  });
}
