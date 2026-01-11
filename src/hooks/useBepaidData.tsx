import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Parsed queue item with extracted card data
export interface QueueItem {
  id: string;
  bepaid_uid: string | null;
  tracking_id: string | null;
  amount: number | null;
  currency: string;
  customer_email: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  // Extracted from raw_payload
  card_holder: string | null;
  card_last4: string | null;
  card_brand: string | null;
  product_name: string | null;
  event_type: string | null;
  order_id: string | null;
  // Matching
  matched_profile_id: string | null;
  matched_profile_name: string | null;
  matched_profile_phone: string | null;
  match_type: 'email' | 'name' | 'manual' | 'none';
}

// Payment from payments_v2 table
export interface PaymentItem {
  id: string;
  order_id: string | null;
  user_id: string | null;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  provider_payment_id: string | null;
  card_last4: string | null;
  card_brand: string | null;
  card_holder: string | null;
  paid_at: string | null;
  created_at: string;
  // Joined data
  order_number: string | null;
  product_name: string | null;
  profile_name: string | null;
  profile_email: string | null;
  profile_phone: string | null;
}

// Extract card data from raw_payload
function parseQueuePayload(rawPayload: any): Partial<QueueItem> {
  if (!rawPayload) return {};
  
  const card = rawPayload.card || {};
  const plan = rawPayload.plan || {};
  const additionalData = rawPayload.additional_data || {};
  
  return {
    card_holder: card.holder || null,
    card_last4: card.last_4 || null,
    card_brand: card.brand || null,
    product_name: plan.title || plan.name || additionalData.description || null,
    event_type: rawPayload.event || null,
    order_id: additionalData.order_id || null,
  };
}

export interface DateFilter {
  from: string;
  to?: string;
}

export function useBepaidQueue(dateFilter?: DateFilter) {
  const queryClient = useQueryClient();

  // Fetch queue items with profile matching (now from DB matched_profile_id)
  const { data: queueItems, isLoading: queueLoading, error: queueError, refetch: refetchQueue } = useQuery({
    queryKey: ["bepaid-queue", dateFilter],
    queryFn: async () => {
      // Build query - only show pending/processing/processed statuses (successful payments)
      let query = supabase
        .from("payment_reconcile_queue")
        .select("*, matched_profile:matched_profile_id(id, full_name, phone, email)")
        .in("status", ["pending", "processing", "processed"])
        .order("created_at", { ascending: false });
      
      // Apply date filter
      const fromDate = dateFilter?.from || "2026-01-01";
      query = query.gte("created_at", `${fromDate}T00:00:00Z`);
      
      if (dateFilter?.to) {
        query = query.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }

      const { data: queue, error: queueError } = await query;
      
      if (queueError) throw queueError;

      // Fetch profiles for auto-matching (email/name)
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, first_name, last_name, email, phone");

      const profilesByEmail = new Map<string, any>();
      const profilesByName = new Map<string, any>();
      
      (profiles || []).forEach(p => {
        if (p.email) profilesByEmail.set(p.email.toLowerCase(), p);
        if (p.full_name) {
          const nameLower = p.full_name.toLowerCase().trim();
          profilesByName.set(nameLower, p);
        }
      });

      // Parse and match
      const items: QueueItem[] = (queue || []).map(q => {
        const parsed = parseQueuePayload(q.raw_payload);
        
        // Priority: DB matched_profile > email match > name match
        let matched_profile_id: string | null = null;
        let matched_profile_name: string | null = null;
        let matched_profile_phone: string | null = null;
        let match_type: 'email' | 'name' | 'manual' | 'none' = 'none';

        // 1. Check if already linked in DB
        const dbProfile = q.matched_profile as any;
        if (q.matched_profile_id && dbProfile) {
          matched_profile_id = dbProfile.id;
          matched_profile_name = dbProfile.full_name;
          matched_profile_phone = dbProfile.phone;
          match_type = 'manual';
        }

        // 2. Match by email from DB
        if (!matched_profile_id && q.customer_email) {
          const profile = profilesByEmail.get(q.customer_email.toLowerCase());
          if (profile) {
            matched_profile_id = profile.id;
            matched_profile_name = profile.full_name;
            matched_profile_phone = profile.phone;
            match_type = 'email';
          }
        }

        // 3. Match by card holder name from DB
        if (!matched_profile_id && parsed.card_holder) {
          const holderNormalized = parsed.card_holder.toLowerCase().trim();
          const profile = profilesByName.get(holderNormalized);
          if (profile) {
            matched_profile_id = profile.id;
            matched_profile_name = profile.full_name;
            matched_profile_phone = profile.phone;
            match_type = 'name';
          }
        }

        return {
          id: q.id,
          bepaid_uid: q.bepaid_uid,
          tracking_id: q.tracking_id,
          amount: q.amount,
          currency: q.currency,
          customer_email: q.customer_email,
          status: q.status,
          attempts: q.attempts,
          last_error: q.last_error,
          card_holder: parsed.card_holder || null,
          card_last4: parsed.card_last4 || null,
          card_brand: parsed.card_brand || null,
          product_name: parsed.product_name || null,
          event_type: parsed.event_type || null,
          order_id: parsed.order_id || null,
          created_at: q.created_at,
          matched_profile_id,
          matched_profile_name,
          matched_profile_phone,
          match_type,
        };
      });

      return items;
    },
  });

  // Link profile manually - save to DB + propagate to other records with same email/name
  const linkProfileMutation = useMutation({
    mutationFn: async ({ 
      queueItemId, 
      profileId,
      propagateEmail,
      propagateName,
    }: { 
      queueItemId: string; 
      profileId: string;
      propagateEmail?: string;
      propagateName?: string;
    }) => {
      // Update the specific queue item
      await supabase
        .from("payment_reconcile_queue")
        .update({ matched_profile_id: profileId })
        .eq("id", queueItemId);

      // Auto-propagate to other items with same email
      if (propagateEmail) {
        await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: profileId })
          .eq("customer_email", propagateEmail)
          .is("matched_profile_id", null);
      }

      // Auto-propagate to other items with same card holder name
      if (propagateName) {
        // Fetch all unlinked items
        const { data: unlinked } = await supabase
          .from("payment_reconcile_queue")
          .select("id, raw_payload")
          .is("matched_profile_id", null);
        
        // Filter by matching card_holder in raw_payload
        const nameNormalized = propagateName.toLowerCase().trim();
        const itemsToUpdate = (unlinked || []).filter(item => {
          const payload = item.raw_payload as Record<string, any> | null;
          const holder = payload?.card?.holder;
          return holder && holder.toLowerCase().trim() === nameNormalized;
        });
        
        // Update all matching items
        if (itemsToUpdate.length > 0) {
          await supabase
            .from("payment_reconcile_queue")
            .update({ matched_profile_id: profileId })
            .in("id", itemsToUpdate.map(i => i.id));
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
      toast.success("Связано с контактом. Записи с тем же email автоматически связаны.");
    },
    onError: (error) => {
      toast.error("Ошибка связывания: " + (error as Error).message);
    },
  });

  const linkProfileManually = (
    queueItemId: string, 
    profile: { id: string; full_name: string | null; phone: string | null; email?: string | null },
    queueItem?: QueueItem
  ) => {
    linkProfileMutation.mutate({
      queueItemId,
      profileId: profile.id,
      propagateEmail: queueItem?.customer_email || undefined,
      propagateName: queueItem?.card_holder || undefined,
    });
  };

  return {
    queueItems: queueItems || [],
    queueLoading,
    queueError,
    refetchQueue,
    linkProfileManually,
  };
}

export function useBepaidPayments(dateFilter?: DateFilter) {
  // Fetch processed payments from payments_v2
  const { data: payments, isLoading: paymentsLoading, error: paymentsError, refetch: refetchPayments } = useQuery({
    queryKey: ["bepaid-payments", dateFilter],
    queryFn: async () => {
      // Build query with date filter
      let query = supabase
        .from("payments_v2")
        .select(`
          id,
          order_id,
          user_id,
          amount,
          currency,
          status,
          provider,
          provider_payment_id,
          card_last4,
          card_brand,
          paid_at,
          created_at,
          provider_response,
          meta
        `)
        .eq("provider", "bepaid")
        .order("created_at", { ascending: false });

      // Apply date filter - default to 2026-01-01
      const fromDate = dateFilter?.from || "2026-01-01";
      query = query.gte("created_at", `${fromDate}T00:00:00Z`);
      
      if (dateFilter?.to) {
        query = query.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }

      const { data: paymentsData, error: paymentsErr } = await query;

      if (paymentsErr) throw paymentsErr;

      // Get order and profile details
      const orderIds = [...new Set((paymentsData || []).filter(p => p.order_id).map(p => p.order_id))];
      const userIds = [...new Set((paymentsData || []).filter(p => p.user_id).map(p => p.user_id))];

      const [ordersResult, profilesResult] = await Promise.all([
        orderIds.length > 0 
          ? supabase.from("orders_v2").select("id, order_number, product_id, purchase_snapshot").in("id", orderIds)
          : { data: [] },
        userIds.length > 0
          ? supabase.from("profiles").select("id, full_name, email, phone").in("id", userIds)
          : { data: [] },
      ]);

      // Get products for names
      const productIds = [...new Set((ordersResult.data || []).filter(o => o.product_id).map(o => o.product_id))];
      const productsResult = productIds.length > 0
        ? await supabase.from("products_v2").select("id, name").in("id", productIds)
        : { data: [] };

      const ordersMap = new Map((ordersResult.data || []).map(o => [o.id, o]));
      const profilesMap = new Map((profilesResult.data || []).map(p => [p.id, p]));
      const productsMap = new Map((productsResult.data || []).map(p => [p.id, p]));

      const items: PaymentItem[] = (paymentsData || []).map(p => {
        const order = ordersMap.get(p.order_id);
        const profile = profilesMap.get(p.user_id);
        const product = order?.product_id ? productsMap.get(order.product_id) : null;
        
        // Extract card holder from provider_response
        let card_holder: string | null = null;
        const providerResponse = p.provider_response as Record<string, any> | null;
        if (providerResponse?.transaction?.credit_card?.holder) {
          card_holder = providerResponse.transaction.credit_card.holder;
        }

        // Get product name from snapshot or product
        let product_name = product?.name || null;
        const purchaseSnapshot = order?.purchase_snapshot as Record<string, any> | null;
        if (!product_name && purchaseSnapshot?.product_name) {
          product_name = purchaseSnapshot.product_name;
        }

        return {
          id: p.id,
          order_id: p.order_id,
          user_id: p.user_id,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          provider: p.provider,
          provider_payment_id: p.provider_payment_id,
          card_last4: p.card_last4,
          card_brand: p.card_brand,
          card_holder,
          paid_at: p.paid_at,
          created_at: p.created_at,
          order_number: order?.order_number || null,
          product_name,
          profile_name: profile?.full_name || null,
          profile_email: profile?.email || null,
          profile_phone: profile?.phone || null,
        };
      });

      return items;
    },
  });

  return {
    payments: payments || [],
    paymentsLoading,
    paymentsError,
    refetchPayments,
  };
}

export function useBepaidStats(dateFilter?: DateFilter) {
  const { data: stats } = useQuery({
    queryKey: ["bepaid-stats", dateFilter],
    queryFn: async () => {
      const fromDate = dateFilter?.from || "2026-01-01";
      
      let paymentsQuery = supabase
        .from("payments_v2")
        .select("id", { count: "exact", head: true })
        .eq("provider", "bepaid")
        .gte("created_at", `${fromDate}T00:00:00Z`);
      
      let queueQuery = supabase
        .from("payment_reconcile_queue")
        .select("id, status")
        .gte("created_at", `${fromDate}T00:00:00Z`);
      
      if (dateFilter?.to) {
        paymentsQuery = paymentsQuery.lte("created_at", `${dateFilter.to}T23:59:59Z`);
        queueQuery = queueQuery.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }

      const [paymentsResult, queueResult] = await Promise.all([
        paymentsQuery,
        queueQuery,
      ]);

      const queueData = queueResult.data || [];
      const pendingCount = queueData.filter(q => q.status === 'pending').length;
      const processingCount = queueData.filter(q => q.status === 'processing').length;
      const errorCount = queueData.filter(q => ['failed', 'error'].includes(q.status)).length;

      return {
        paymentsCount: paymentsResult.count || 0,
        queueTotal: queueData.length,
        queuePending: pendingCount,
        queueProcessing: processingCount,
        queueErrors: errorCount,
      };
    },
  });

  return stats || {
    paymentsCount: 0,
    queueTotal: 0,
    queuePending: 0,
    queueProcessing: 0,
    queueErrors: 0,
  };
}

// Get unique product names from queue for mapping reference
export function useQueueProductNames(dateFilter?: DateFilter) {
  return useQuery({
    queryKey: ["bepaid-queue-product-names", dateFilter],
    queryFn: async () => {
      const fromDate = dateFilter?.from || "2026-01-01";
      
      let query = supabase
        .from("payment_reconcile_queue")
        .select("raw_payload")
        .gte("created_at", `${fromDate}T00:00:00Z`);
      
      if (dateFilter?.to) {
        query = query.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Extract unique product names with counts and amounts
      const productMap = new Map<string, { count: number; amounts: Set<number>; descriptions: Set<string> }>();

      (data || []).forEach(q => {
        const payload = q.raw_payload as Record<string, any> | null;
        if (!payload) return;

        const plan = payload.plan || {};
        const additionalData = payload.additional_data || {};
        const productName = plan.title || plan.name || additionalData.description;

        if (productName) {
          const existing = productMap.get(productName) || { count: 0, amounts: new Set(), descriptions: new Set() };
          existing.count++;
          if (plan.amount) existing.amounts.add(plan.amount / 100);
          if (additionalData.description) existing.descriptions.add(additionalData.description);
          productMap.set(productName, existing);
        }
      });

      return Array.from(productMap.entries()).map(([name, data]) => ({
        name,
        count: data.count,
        amounts: Array.from(data.amounts).sort((a, b) => a - b),
        descriptions: Array.from(data.descriptions),
      })).sort((a, b) => b.count - a.count);
    },
  });
}
