import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DateFilter {
  from: string;
  to?: string;
}

export interface UnifiedPayment {
  id: string;
  uid: string; // bepaid_uid or provider_payment_id
  source: 'queue' | 'payments_v2'; // Data source
  
  // Transaction info
  transaction_type: string | null; // payment, subscription, refund, void, chargeback
  status_normalized: string; // successful, pending, failed, refunded
  amount: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
  
  // Payer info
  customer_email: string | null;
  customer_phone: string | null;
  card_holder: string | null;
  card_last4: string | null;
  card_brand: string | null;
  
  // Linked contact
  profile_id: string | null;
  profile_name: string | null;
  profile_email: string | null;
  profile_phone: string | null;
  is_ghost: boolean;
  
  // Linked deal
  order_id: string | null;
  order_number: string | null;
  order_status: string | null;
  
  // Product/tariff mapping
  bepaid_product: string | null; // plan.title or description from bePaid
  mapped_product_id: string | null;
  mapped_tariff_id: string | null;
  mapped_offer_id: string | null;
  product_name: string | null; // Resolved product name
  
  // Receipt
  receipt_url: string | null;
  
  // Refunds
  refunds_count: number;
  total_refunded: number;
  
  // Flags
  is_external: boolean;
  has_conflict: boolean;
  
  // Provider
  provider: string;
  tracking_id: string | null;
}

export interface PaymentsStats {
  total: number;
  inQueue: number;
  processed: number;
  withContact: number;
  withoutContact: number;
  withDeal: number;
  withoutDeal: number;
  withReceipt: number;
  withoutReceipt: number;
  withRefunds: number;
  external: number;
  conflicts: number;
  totalAmount: number;
  totalRefunded: number;
}

export function useUnifiedPayments(dateFilter: DateFilter) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["unified-payments", dateFilter],
    queryFn: async () => {
      const fromDate = dateFilter.from || "2026-01-01";
      
      // Fetch from payment_reconcile_queue (queue items)
      let queueQuery = supabase
        .from("payment_reconcile_queue")
        .select(`
          id, bepaid_uid, tracking_id, amount, currency, 
          customer_email, customer_phone, customer_name, customer_surname,
          card_holder, card_last4, card_brand, 
          status, status_normalized, transaction_type,
          paid_at, created_at, source, receipt_url, description, product_name,
          matched_profile_id, matched_order_id, matched_product_id, matched_tariff_id, matched_offer_id,
          is_external, has_conflict, provider,
          profiles:matched_profile_id(id, full_name, email, phone, user_id),
          orders:matched_order_id(id, order_number, status)
        `)
        .eq("is_fee", false)
        .not("bepaid_uid", "is", null)
        .gte("created_at", `${fromDate}T00:00:00Z`)
        .order("paid_at", { ascending: false, nullsFirst: false });
      
      if (dateFilter.to) {
        queueQuery = queueQuery.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }
      
      // Fetch from payments_v2 (processed payments)
      let paymentsQuery = supabase
        .from("payments_v2")
        .select(`
          id, provider_payment_id, order_id, user_id, profile_id,
          amount, currency, status, provider,
          card_last4, card_brand, paid_at, created_at,
          receipt_url, refunds, refunded_amount, provider_response, meta,
          orders:order_id(id, order_number, status, product_id, purchase_snapshot),
          profiles:profile_id(id, full_name, email, phone, user_id)
        `)
        .eq("provider", "bepaid")
        .gte("created_at", `${fromDate}T00:00:00Z`)
        .order("paid_at", { ascending: false, nullsFirst: false });
      
      if (dateFilter.to) {
        paymentsQuery = paymentsQuery.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }
      
      const [queueResult, paymentsResult] = await Promise.all([
        queueQuery,
        paymentsQuery,
      ]);
      
      if (queueResult.error) throw queueResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      
      // Get product names for orders
      const productIds = new Set<string>();
      (paymentsResult.data || []).forEach(p => {
        const order = p.orders as any;
        if (order?.product_id) productIds.add(order.product_id);
      });
      
      const productsResult = productIds.size > 0
        ? await supabase.from("products_v2").select("id, name").in("id", Array.from(productIds))
        : { data: [] };
      
      const productsMap = new Map((productsResult.data || []).map(p => [p.id, p.name]));
      
      // Track UIDs from payments_v2 to deduplicate
      const processedUids = new Set<string>();
      
      // Transform payments_v2 data
      const paymentsData: UnifiedPayment[] = (paymentsResult.data || []).map(p => {
        const order = p.orders as any;
        const profile = p.profiles as any;
        const providerResponse = p.provider_response as any;
        const refunds = (p.refunds || []) as any[];
        
        // Extract card holder from provider_response
        let card_holder: string | null = null;
        if (providerResponse?.transaction?.credit_card?.holder) {
          card_holder = providerResponse.transaction.credit_card.holder;
        }
        
        // Get product name
        let product_name = order?.product_id ? productsMap.get(order.product_id) || null : null;
        const purchaseSnapshot = order?.purchase_snapshot as any;
        if (!product_name && purchaseSnapshot?.product_name) {
          product_name = purchaseSnapshot.product_name;
        }
        
        // Extract UID
        const uid = p.provider_payment_id || p.id;
        processedUids.add(uid);
        
        return {
          id: p.id,
          uid,
          source: 'payments_v2' as const,
          transaction_type: 'payment',
          status_normalized: p.status,
          amount: p.amount,
          currency: p.currency,
          paid_at: p.paid_at,
          created_at: p.created_at,
          customer_email: profile?.email || null,
          customer_phone: profile?.phone || null,
          card_holder,
          card_last4: p.card_last4,
          card_brand: p.card_brand,
          profile_id: p.profile_id || profile?.id || null,
          profile_name: profile?.full_name || null,
          profile_email: profile?.email || null,
          profile_phone: profile?.phone || null,
          is_ghost: profile ? !profile.user_id : false,
          order_id: p.order_id,
          order_number: order?.order_number || null,
          order_status: order?.status || null,
          bepaid_product: purchaseSnapshot?.product_name || null,
          mapped_product_id: order?.product_id || null,
          mapped_tariff_id: null,
          mapped_offer_id: null,
          product_name,
          receipt_url: p.receipt_url,
          refunds_count: refunds.length,
          total_refunded: p.refunded_amount || 0,
          is_external: false,
          has_conflict: false,
          provider: p.provider || 'bepaid',
          tracking_id: null,
        };
      });
      
      // Transform queue data (only items not in payments_v2)
      const queueData: UnifiedPayment[] = (queueResult.data || [])
        .filter(q => {
          // Skip if already processed in payments_v2
          if (q.bepaid_uid && processedUids.has(q.bepaid_uid)) return false;
          
          // Only show successful transactions or pending without errors
          const statusNorm = q.status_normalized as string | null;
          if (statusNorm === 'successful') return true;
          if (['processing', 'processed', 'completed'].includes(q.status)) return true;
          if (q.status === 'pending' && !statusNorm) return true;
          return false;
        })
        .map(q => {
          const profile = q.profiles as any;
          const order = q.orders as any;
          
          return {
            id: q.id,
            uid: q.bepaid_uid || q.id,
            source: 'queue' as const,
            transaction_type: q.transaction_type || 'payment',
            status_normalized: q.status_normalized || q.status || 'pending',
            amount: q.amount || 0,
            currency: q.currency || 'BYN',
            paid_at: q.paid_at,
            created_at: q.created_at,
            customer_email: q.customer_email,
            customer_phone: q.customer_phone,
            card_holder: q.card_holder,
            card_last4: q.card_last4,
            card_brand: q.card_brand,
            profile_id: q.matched_profile_id || profile?.id || null,
            profile_name: profile?.full_name || null,
            profile_email: profile?.email || null,
            profile_phone: profile?.phone || null,
            is_ghost: profile ? !profile.user_id : false,
            order_id: q.matched_order_id || order?.id || null,
            order_number: order?.order_number || null,
            order_status: order?.status || null,
            bepaid_product: q.description || q.product_name || null,
            mapped_product_id: q.matched_product_id,
            mapped_tariff_id: q.matched_tariff_id,
            mapped_offer_id: q.matched_offer_id,
            product_name: q.product_name || q.description || null,
            receipt_url: q.receipt_url,
            refunds_count: 0,
            total_refunded: 0,
            is_external: q.is_external || false,
            has_conflict: q.has_conflict || false,
            provider: q.provider || 'bepaid',
            tracking_id: q.tracking_id,
          };
        });
      
      // Combine and sort by paid_at (newest first)
      const allPayments = [...paymentsData, ...queueData].sort((a, b) => {
        const dateA = new Date(a.paid_at || a.created_at).getTime();
        const dateB = new Date(b.paid_at || b.created_at).getTime();
        return dateB - dateA;
      });
      
      // Calculate stats
      const stats: PaymentsStats = {
        total: allPayments.length,
        inQueue: queueData.length,
        processed: paymentsData.length,
        withContact: allPayments.filter(p => p.profile_id).length,
        withoutContact: allPayments.filter(p => !p.profile_id).length,
        withDeal: allPayments.filter(p => p.order_id).length,
        withoutDeal: allPayments.filter(p => !p.order_id).length,
        withReceipt: allPayments.filter(p => p.receipt_url).length,
        withoutReceipt: allPayments.filter(p => !p.receipt_url).length,
        withRefunds: allPayments.filter(p => p.refunds_count > 0).length,
        external: allPayments.filter(p => p.is_external).length,
        conflicts: allPayments.filter(p => p.has_conflict).length,
        totalAmount: allPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
        totalRefunded: allPayments.reduce((sum, p) => sum + (p.total_refunded || 0), 0),
      };
      
      return { payments: allPayments, stats };
    },
    staleTime: 30000,
  });

  return {
    payments: data?.payments || [],
    stats: data?.stats || {
      total: 0,
      inQueue: 0,
      processed: 0,
      withContact: 0,
      withoutContact: 0,
      withDeal: 0,
      withoutDeal: 0,
      withReceipt: 0,
      withoutReceipt: 0,
      withRefunds: 0,
      external: 0,
      conflicts: 0,
      totalAmount: 0,
      totalRefunded: 0,
    },
    isLoading,
    error,
    refetch,
  };
}
