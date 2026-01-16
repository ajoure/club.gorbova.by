import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DateFilter {
  from: string;
  to?: string;
}

// Source types for UI filtering
export type PaymentSource = 'webhook' | 'api' | 'file_import' | 'processed';

export interface UnifiedPayment {
  id: string;
  uid: string; // bepaid_uid or provider_payment_id
  source: PaymentSource; // Data source for filtering
  rawSource: 'queue' | 'payments_v2'; // Internal data source
  
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
  tariff_name: string | null; // Tariff name from snapshot
  offer_name: string | null; // Offer name from snapshot
  
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
  
  // Raw provider response for payment method detection
  provider_response?: any;
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
  pending: number;
  failed: number;
  successful: number;
  refunded: number;
  cancelled: number;
}

export function useUnifiedPayments(dateFilter: DateFilter) {
  const queryClient = useQueryClient();

  // Realtime subscription for automatic updates
  useEffect(() => {
    const channel = supabase
      .channel('payments-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'payments_v2' },
        (payload) => {
          console.log('[Realtime] payments_v2 INSERT:', payload.new);
          queryClient.invalidateQueries({ queryKey: ['unified-payments'] });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payments_v2' },
        (payload) => {
          console.log('[Realtime] payments_v2 UPDATE:', payload.new);
          queryClient.invalidateQueries({ queryKey: ['unified-payments'] });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'payment_reconcile_queue' },
        (payload) => {
          console.log('[Realtime] queue INSERT:', payload.new);
          queryClient.invalidateQueries({ queryKey: ['unified-payments'] });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payment_reconcile_queue' },
        (payload) => {
          console.log('[Realtime] queue UPDATE:', payload.new);
          queryClient.invalidateQueries({ queryKey: ['unified-payments'] });
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["unified-payments", dateFilter],
    queryFn: async () => {
      // Default to early date to show ALL historical data (no hidden payments)
      const fromDate = dateFilter.from || "2020-01-01";
      
      // Fetch from payment_reconcile_queue (queue items) - NO STATUS FILTER, show all
      // IMPORTANT: Filter by paid_at (actual payment date), not created_at (import date)
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
          orders:matched_order_id(id, order_number, status, profile_id, profiles(id, full_name, email, phone, user_id))
        `)
        .eq("is_fee", false)
        .not("bepaid_uid", "is", null)
        .gte("paid_at", `${fromDate}T00:00:00Z`)
        .order("paid_at", { ascending: false, nullsFirst: false });
      
      if (dateFilter.to) {
        queueQuery = queueQuery.lte("paid_at", `${dateFilter.to}T23:59:59Z`);
      }
      
      // Fetch from payments_v2 (processed payments)
      // IMPORTANT: Filter by paid_at (actual payment date), not created_at (import date)
      let paymentsQuery = supabase
        .from("payments_v2")
        .select(`
          id, provider_payment_id, order_id, user_id, profile_id,
          amount, currency, status, provider,
          card_last4, card_brand, paid_at, created_at,
          receipt_url, refunds, refunded_amount, provider_response, meta,
          orders:order_id(id, order_number, status, product_id, purchase_snapshot, profile_id, profiles(id, full_name, email, phone, user_id)),
          profiles:profile_id(id, full_name, email, phone, user_id)
        `)
        .eq("provider", "bepaid")
        .gte("paid_at", `${fromDate}T00:00:00Z`)
        .order("paid_at", { ascending: false, nullsFirst: false });
      
      if (dateFilter.to) {
        paymentsQuery = paymentsQuery.lte("paid_at", `${dateFilter.to}T23:59:59Z`);
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
      
      // Dedup key: provider:uid - ONLY provider_payment_id, not fallback to id
      const processedKeys = new Set<string>();
      
      // Transform payments_v2 data
      const paymentsData: UnifiedPayment[] = (paymentsResult.data || []).map(p => {
        const order = p.orders as any;
        const directProfile = p.profiles as any;
        
        // A1: Auto-link contact through deal - Priority: payment.profile -> order.profile
        const orderProfile = order?.profiles as any;
        const profile = directProfile || orderProfile || null;
        const effectiveProfileId = p.profile_id || order?.profile_id || null;
        
        const providerResponse = p.provider_response as any;
        const refunds = (p.refunds || []) as any[];
        
        // Extract card holder from provider_response
        let card_holder: string | null = null;
        if (providerResponse?.transaction?.credit_card?.holder) {
          card_holder = providerResponse.transaction.credit_card.holder;
        }
        
        // Get product name and tariff name from snapshot
        let product_name = order?.product_id ? productsMap.get(order.product_id) || null : null;
        const purchaseSnapshot = order?.purchase_snapshot as any;
        if (!product_name && purchaseSnapshot?.product_name) {
          product_name = purchaseSnapshot.product_name;
        }
        
        // Extract tariff name from snapshot
        const tariff_name = purchaseSnapshot?.tariff_name 
          || purchaseSnapshot?.plan_title 
          || null;
        
        // Extract offer name from snapshot
        const offer_name = purchaseSnapshot?.offer_name || null;
        
        // Extract UID - MUST be provider_payment_id for proper dedup
        const pUid = p.provider_payment_id;
        const provider = p.provider || 'bepaid';
        
        // Only add to dedup set if we have a real UID
        if (pUid) {
          processedKeys.add(`${provider}:${pUid}`);
        }
        
        return {
          id: p.id,
          uid: pUid || p.id,
          source: 'processed' as PaymentSource,
          rawSource: 'payments_v2' as const,
          transaction_type: 'payment',
          status_normalized: p.status || 'pending',
          amount: p.amount,
          currency: p.currency,
          paid_at: p.paid_at,
          created_at: p.created_at,
          customer_email: profile?.email || null,
          customer_phone: profile?.phone || null,
          card_holder,
          card_last4: p.card_last4,
          card_brand: p.card_brand,
          profile_id: effectiveProfileId,
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
          tariff_name,
          offer_name,
          receipt_url: p.receipt_url,
          refunds_count: refunds.length,
          total_refunded: p.refunded_amount || 0,
          is_external: false,
          has_conflict: false,
          provider,
          tracking_id: null,
          provider_response: providerResponse,
        };
      });
      
      // Transform queue data - NO STATUS FILTER, show all (pending/failed/refunded)
      const queueData: UnifiedPayment[] = (queueResult.data || [])
        .filter(q => {
          // Dedup only by provider:uid key
          const qUid = q.bepaid_uid;
          const provider = q.provider || 'bepaid';
          const key = `${provider}:${qUid}`;
          
          // Skip if already processed in payments_v2
          if (qUid && processedKeys.has(key)) return false;
          
          return true;
        })
        .map(q => {
          const directProfile = q.profiles as any;
          const order = q.orders as any;
          
          // A1: Auto-link contact through deal - Priority: matched_profile -> order.profile
          const orderProfile = order?.profiles as any;
          const profile = directProfile || orderProfile || null;
          const effectiveProfileId = q.matched_profile_id || order?.profile_id || profile?.id || null;
          
          // Normalize source for UI filtering
          let uiSource: PaymentSource = 'webhook';
          if (q.source === 'api' || q.source === 'api_polling') {
            uiSource = 'api';
          } else if (q.source === 'file_import' || q.source === 'csv') {
            uiSource = 'file_import';
          } else if (q.source === 'webhook') {
            uiSource = 'webhook';
          }
          
          // Determine if this is a refund transaction
          const txType = (q.transaction_type || '').toLowerCase();
          const statusNorm = (q.status_normalized || '').toLowerCase();
          const rawStatus = (q.status || '').toLowerCase();
          const isRefundTransaction = 
            txType === 'возврат средств' ||
            txType === 'refund' ||
            txType.includes('возврат') ||
            statusNorm === 'refunded' ||
            statusNorm === 'refund';
          
          // Determine if this is a cancelled transaction
          const isCancelledTransaction = 
            txType === 'отмена' ||
            txType.includes('отмен') ||
            txType.includes('cancel') ||
            statusNorm === 'cancelled';
          
          // Invert amount for refunds and cancellations (show as negative)
          const rawAmount = q.amount || 0;
          const effectiveAmount = (isRefundTransaction || isCancelledTransaction) ? -Math.abs(rawAmount) : rawAmount;
          
          return {
            id: q.id,
            uid: q.bepaid_uid || q.id,
            source: uiSource,
            rawSource: 'queue' as const,
            transaction_type: q.transaction_type || 'payment',
            // FIX: Queue status is JOB status, not payment status!
            // If job status is 'cancelled' but status_normalized is 'successful' -> payment is successful
            status_normalized: q.status_normalized || 
              (rawStatus === 'cancelled' ? 'pending' : rawStatus) || 
              'pending',
            amount: effectiveAmount,
            currency: q.currency || 'BYN',
            paid_at: q.paid_at,
            created_at: q.created_at,
            customer_email: q.customer_email,
            customer_phone: q.customer_phone,
            card_holder: q.card_holder,
            card_last4: q.card_last4,
            card_brand: q.card_brand,
            profile_id: effectiveProfileId,
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
            tariff_name: null, // Queue items don't have tariff resolved yet
            offer_name: null, // Queue items don't have offer resolved yet
            receipt_url: q.receipt_url,
            refunds_count: 0,
            total_refunded: 0,
            is_external: q.is_external || false,
            has_conflict: q.has_conflict || false,
            provider: q.provider || 'bepaid',
            tracking_id: q.tracking_id,
            provider_response: null, // Queue items don't have full provider response
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
        // totalAmount: only positive amounts (payments)
        totalAmount: allPayments.filter(p => p.amount > 0).reduce((sum, p) => sum + p.amount, 0),
        // totalRefunded: sum of absolute values of negative amounts (refunds)
        totalRefunded: allPayments.filter(p => p.amount < 0).reduce((sum, p) => sum + Math.abs(p.amount), 0) 
          + allPayments.reduce((sum, p) => sum + (p.total_refunded || 0), 0),
        pending: allPayments.filter(p => p.status_normalized === 'pending').length,
        failed: allPayments.filter(p => ['failed', 'error', 'declined'].includes(p.status_normalized)).length,
        successful: allPayments.filter(p => ['successful', 'succeeded'].includes(p.status_normalized) && p.amount > 0).length,
        // FIX: Count refunds by status OR transaction_type OR negative amount
        refunded: allPayments.filter(p => {
          const txType = (p.transaction_type || '').toLowerCase();
          return ['refunded', 'refund'].includes(p.status_normalized) ||
                 txType.includes('возврат') ||
                 txType === 'refund' ||
                 p.amount < 0;
        }).length,
        cancelled: allPayments.filter(p => ['cancelled', 'canceled', 'expired', 'voided'].includes(p.status_normalized)).length,
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
      pending: 0,
      failed: 0,
      successful: 0,
      refunded: 0,
      cancelled: 0,
    },
    isLoading,
    error,
    refetch,
  };
}
