import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { classifyPayment } from "@/lib/paymentClassification";
import { buildSearchIndex } from "@/lib/multiTermSearch";
import { extractStripeCardFromMeta } from "@/utils/extractStripeCardFromMeta";
export interface DateFilter {
  from: string;
  to?: string;
  includeImport?: boolean; // Toggle to include origin='import' records
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
  
  // Classification (PATCH-F: for card_verification)
  payment_classification: string | null;
  origin: string | null;
  
  // Payer info
  customer_email: string | null;
  customer_phone: string | null;
  card_holder: string | null;
  card_last4: string | null;
  card_brand: string | null;
  // Stage 2E: derived payer view (Stripe-aware + refund→parent inheritance).
  payer_card_brand: string | null;
  payer_card_last4: string | null;
  payer_card_wallet: 'apple_pay' | 'google_pay' | 'samsung_pay' | null;
  payer_card_source:
    | 'db_columns'
    | 'stripe_meta'
    | 'stripe_provider_response'
    | 'parent_payment'
    | 'parent_db_columns'
    | null;
  
  // Linked contact
  profile_id: string | null;
  profile_name: string | null;
  profile_email: string | null;
  profile_phone: string | null;
  is_ghost: boolean;
  
  // Linked deal (raw from payments_v2)
  order_id: string | null;
  order_number: string | null;
  order_status: string | null;
  
  // F13.ADD: Resolved deal (cross-reference queue → payments_v2)
  effective_order_id: string | null;
  effective_order_number: string | null;
  effective_order_status: string | null;
  effective_deal_source: 'payment' | 'queue' | 'none';
  
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
  
  // Real commission from bePaid statement
  commission_total: number | null;
  
  // bePaid description for display and search
  bepaid_description: string | null;

  // Phase 9-B — Stripe document/subscription visibility (read-only, from payments_v2.meta.stripe)
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf: string | null;

  // Stage 2C — единый URL документа для рендера (UI-derived; не SOT).
  // bePaid: receipt_url. Stripe payment: charge.receipt_url > receipt_url > invoice hosted > invoice pdf.
  // Stripe refund: refund hosted > parent charge receipt > parent invoice hosted.
  document_url: string | null;
  // 'charge_receipt' | 'receipt_url' | 'invoice_hosted' | 'invoice_pdf'
  // | 'refund_receipt' | 'parent_charge_receipt' | 'parent_invoice_hosted' | null
  document_url_source: string | null;


  // P0-guard: Pre-built search index (computed once during transformation)
  search_index: string;
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

// Helper to fetch all pages from Supabase (bypasses 1000 row limit)
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  buildQuery: (page: number) => any
): Promise<T[]> {
  const allData: T[] = [];
  let page = 0;
  let hasMore = true;
  
  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    
    const { data, error } = await buildQuery(page).range(from, to);
    
    if (error) throw error;
    
    if (data && data.length > 0) {
      allData.push(...data);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  
  console.log(`[Unified Payments] Fetched ${allData.length} records in ${page} pages`);
  return allData;
}

export function useUnifiedPayments(dateFilter: DateFilter) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    // Use primitives for stable queryKey (not object reference)
    queryKey: ["unified-payments", dateFilter.from, dateFilter.to || null, dateFilter.includeImport ?? false],
    queryFn: async () => {
      // Default to early date to show ALL historical data (no hidden payments)
      const fromDate = dateFilter.from || "2020-01-01";
      const toDate = dateFilter.to;
      
      console.log(`[Unified Payments] Loading data for period: ${fromDate} to ${toDate || 'now'}`);
      
      // Build queue query factory for pagination
      const buildQueueQuery = () => {
        let query = supabase
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
          .gte("paid_at", `${fromDate}T00:00:00Z`);
        
        if (toDate) {
          query = query.lte("paid_at", `${toDate}T23:59:59Z`);
        }
        
        // IMPORTANT: order() must come before range() for proper pagination
        return query.order("paid_at", { ascending: false, nullsFirst: false });
      };
      
      // Build payments query factory for pagination
      // includeImport: if true, include origin='import' records
      const includeImport = dateFilter.includeImport || false;
      
      const buildPaymentsQuery = () => {
        let query = supabase
          .from("payments_v2")
          .select(`
            id, provider_payment_id, order_id, user_id, profile_id,
            amount, currency, status, transaction_type, provider, origin, payment_classification,
            card_last4, card_brand, paid_at, created_at,
            receipt_url, refunds, refunded_amount, provider_response, meta,
            orders:order_id(id, order_number, status, product_id, purchase_snapshot, profile_id, profiles(id, full_name, email, phone, user_id)),
            profiles:profile_id(id, full_name, email, phone, user_id)
          `)
          // PATCH-LIVE-2: грузим и bePaid, и Stripe. UI-фильтр "Провайдер" (PaymentsTabContent)
          // применяется клиентом: all/bepaid/stripe. Stripe-платежи сейчас пишутся с
          // origin='bepaid' (default колонки), поэтому отдельной нормализации origin не нужно —
          // ниже OR уже включает 'bepaid' и origin IS NULL.
          .in("provider", ["bepaid", "stripe"]);
        
        // PATCH-C1: Removed .not("paid_at", "is", null) to show processing/pending transactions
        // PATCH-C1: Removed strict origin filter - show all origins including manual_adjustment
        // Filter by origin based on includeImport toggle (expanded to include all legitimate origins)
        if (includeImport) {
          query = query.in("origin", ["bepaid", "import", "statement_sync", "manual_adjustment", "card_verification", "payment_link"]);
        } else {
          // Show all non-import origins (PATCH-F: include card_verification, PATCH-PL: include payment_link)
          // PATCH-LIVE-2: origin IS NULL допустим — на случай если для будущих Stripe-платежей origin не проставится.
          query = query.or("origin.eq.bepaid,origin.eq.statement_sync,origin.eq.manual_adjustment,origin.eq.card_verification,origin.eq.payment_link,origin.is.null");
        }
        
        query = query.gte("paid_at", `${fromDate}T00:00:00Z`);
        
        if (toDate) {
          query = query.lte("paid_at", `${toDate}T23:59:59Z`);
        }
        
        // IMPORTANT: order() must come before range() for proper pagination
        return query.order("paid_at", { ascending: false, nullsFirst: false });
      };
      
      // Fetch status overrides (small table, no pagination needed)
      const overridesQuery = supabase
        .from("payment_status_overrides")
        .select("provider, uid, status_override");
      
      // Fetch all data with pagination
      const [queueData, paymentsData, overridesResult] = await Promise.all([
        fetchAllPages<any>(buildQueueQuery),
        fetchAllPages<any>(buildPaymentsQuery),
        overridesQuery,
      ]);
      
      console.log(`[Unified Payments] Queue: ${queueData.length}, Payments: ${paymentsData.length}`);
      
      // Overrides are optional, don't throw on error
      
      // Build overrides map: provider:uid -> status_override
      const overridesMap = new Map<string, string>();
      (overridesResult.data || []).forEach(o => {
        overridesMap.set(`${o.provider}:${o.uid}`, o.status_override);
      });
      
      // Get product names for orders
      const productIds = new Set<string>();
      paymentsData.forEach(p => {
        const order = p.orders as any;
        if (order?.product_id) productIds.add(order.product_id);
      });
      
      const productsResult = productIds.size > 0
        ? await supabase.from("products_v2").select("id, name").in("id", Array.from(productIds))
        : { data: [] };
      
      const productsMap = new Map((productsResult.data || []).map(p => [p.id, p.name]));
      
      // F13.ADD: Build cross-reference map from ALL queue records BEFORE dedup
      // This allows payments_v2 records to inherit matched_order_id from queue
      const uidToQueue = new Map<string, {
        matched_order_id: string | null;
        order_number: string | null;
        order_status: string | null;
        description: string | null;
      }>();
      for (const q of queueData) {
        if (q.bepaid_uid && q.matched_order_id) {
          const qOrder = q.orders as any;
          uidToQueue.set(q.bepaid_uid, {
            matched_order_id: q.matched_order_id,
            order_number: qOrder?.order_number || null,
            order_status: qOrder?.status || null,
            description: q.description || q.product_name || null,
          });
        }
      }
      
      // Dedup key: provider:uid - ONLY provider_payment_id, not fallback to id
      const processedKeys = new Set<string>();

      // Stage 2C — Parent index для Stripe refund → parent charge receipt fallback.
      // Stage 2E — расширен: индексирует payer card (brand/last4/wallet) для наследования
      //            refund-строкой карточных данных родительского платежа.
      // Ключи: payments_v2.id (UUID) и provider_payment_id (pi_*/ch_*).
      type StripeParentDoc = {
        receipt_url: string | null;
        charge_receipt_url: string | null;
        hosted_invoice_url: string | null;
        invoice_pdf: string | null;
        card_brand: string | null;
        card_last4: string | null;
        card_wallet: 'apple_pay' | 'google_pay' | 'samsung_pay' | null;
      };
      const stripeParentIndex = new Map<string, StripeParentDoc>();
      for (const p of paymentsData) {
        if ((p.provider || '').toLowerCase() !== 'stripe') continue;
        const meta = (p.meta || {}) as any;
        const sm = (meta?.stripe || {}) as any;
        const cardFromMeta = extractStripeCardFromMeta(meta);
        const doc: StripeParentDoc = {
          receipt_url: p.receipt_url ?? null,
          charge_receipt_url: sm?.charge?.receipt_url ?? null,
          hosted_invoice_url:
            sm?.hosted_invoice_url ?? sm?.invoice?.hosted_invoice_url ?? null,
          invoice_pdf: sm?.invoice_pdf ?? sm?.invoice?.invoice_pdf ?? null,
          card_brand: cardFromMeta.brand ?? p.card_brand ?? null,
          card_last4: cardFromMeta.last4 ?? p.card_last4 ?? null,
          card_wallet: cardFromMeta.wallet,
        };
        if (p.id) stripeParentIndex.set(p.id, doc);
        if (p.provider_payment_id) stripeParentIndex.set(p.provider_payment_id, doc);
        if (sm?.charge_id) stripeParentIndex.set(sm.charge_id, doc);
        if (sm?.payment_intent_id) stripeParentIndex.set(sm.payment_intent_id, doc);
      }


      function resolveDocumentUrl(
        p: any,
        provider: string,
      ): { url: string | null; source: string | null } {
        const prov = provider.toLowerCase();
        if (prov !== 'stripe') {
          return p.receipt_url
            ? { url: p.receipt_url, source: 'receipt_url' }
            : { url: null, source: null };
        }
        const meta = (p.meta || {}) as any;
        const sm = (meta?.stripe || {}) as any;
        const isRefund = ((p as any).transaction_type || '').toLowerCase() === 'refund';

        if (!isRefund) {
          // Stripe payment row
          if (sm?.charge?.receipt_url) return { url: sm.charge.receipt_url, source: 'charge_receipt' };
          if (p.receipt_url) return { url: p.receipt_url, source: 'receipt_url' };
          if (sm?.hosted_invoice_url) return { url: sm.hosted_invoice_url, source: 'invoice_hosted' };
          if (sm?.invoice?.hosted_invoice_url) return { url: sm.invoice.hosted_invoice_url, source: 'invoice_hosted' };
          if (sm?.invoice_pdf) return { url: sm.invoice_pdf, source: 'invoice_pdf' };
          if (sm?.invoice?.invoice_pdf) return { url: sm.invoice.invoice_pdf, source: 'invoice_pdf' };
          return { url: null, source: null };
        }

        // Stripe refund row
        const refundResp =
          meta?.provider_response?.stripe?.refund ??
          sm?.refund ??
          null;
        if (refundResp?.receipt_url) return { url: refundResp.receipt_url, source: 'refund_receipt' };
        if (refundResp?.hosted_receipt_url) return { url: refundResp.hosted_receipt_url, source: 'refund_receipt' };

        // Fallback: parent charge receipt via several keys.
        const parentKeys: (string | null | undefined)[] = [
          meta?.parent_payment_id,
          meta?.parent_payment_uid,
          refundResp?.payment_intent,
          refundResp?.charge,
          meta?.provider_response?.stripe?.payment_intent,
          meta?.provider_response?.stripe?.charge_id,
          sm?.payment_intent_id,
          sm?.charge_id,
        ];
        for (const k of parentKeys) {
          if (!k) continue;
          const parent = stripeParentIndex.get(k);
          if (!parent) continue;
          if (parent.charge_receipt_url) return { url: parent.charge_receipt_url, source: 'parent_charge_receipt' };
          if (parent.receipt_url) return { url: parent.receipt_url, source: 'parent_charge_receipt' };
          if (parent.hosted_invoice_url) return { url: parent.hosted_invoice_url, source: 'parent_invoice_hosted' };
        }
        return { url: null, source: null };
      }

      // Stage 2E — payer card resolver. Stripe-aware + refund→parent inheritance.
      function resolvePayerCard(p: any): {
        brand: string | null;
        last4: string | null;
        wallet: 'apple_pay' | 'google_pay' | 'samsung_pay' | null;
        source:
          | 'db_columns'
          | 'stripe_meta'
          | 'stripe_provider_response'
          | 'parent_payment'
          | 'parent_db_columns'
          | null;
      } {
        const prov = String(p.provider || '').toLowerCase();
        const isRefund = String(p.transaction_type || '').toLowerCase() === 'refund';
        const meta = (p.meta || {}) as any;

        if (prov !== 'stripe') {
          if (p.card_brand || p.card_last4) {
            return {
              brand: p.card_brand ?? null,
              last4: p.card_last4 ?? null,
              wallet: null,
              source: 'db_columns',
            };
          }
          return { brand: null, last4: null, wallet: null, source: null };
        }

        // Stripe: prefer DB columns (already populated by targeted card fetch).
        if (p.card_brand || p.card_last4) {
          return {
            brand: p.card_brand ?? null,
            last4: p.card_last4 ?? null,
            wallet: null,
            source: 'db_columns',
          };
        }

        // Stripe meta extraction.
        const fromMeta = extractStripeCardFromMeta(meta);
        if (fromMeta.brand || fromMeta.last4 || fromMeta.wallet) {
          return { ...fromMeta, source: 'stripe_meta' };
        }

        // Refund → parent payment lookup.
        if (isRefund) {
          const sm = (meta?.stripe || {}) as any;
          const pr = (meta?.provider_response?.stripe || {}) as any;
          const refundResp = pr?.refund ?? sm?.refund ?? null;
          const parentKeys: (string | null | undefined)[] = [
            meta?.parent_payment_id,
            meta?.parent_payment_uid,
            refundResp?.payment_intent,
            refundResp?.charge,
            pr?.payment_intent,
            pr?.charge_id,
            sm?.payment_intent_id,
            sm?.charge_id,
          ];
          for (const k of parentKeys) {
            if (!k) continue;
            const parent = stripeParentIndex.get(k);
            if (!parent) continue;
            if (parent.card_brand || parent.card_last4 || parent.card_wallet) {
              return {
                brand: parent.card_brand,
                last4: parent.card_last4,
                wallet: parent.card_wallet,
                source: 'parent_payment',
              };
            }
          }
        }

        return { brand: null, last4: null, wallet: null, source: null };
      }


      // Transform payments_v2 data
      const transformedPayments: UnifiedPayment[] = paymentsData.map(p => {
        const order = p.orders as any;
        const directProfile = p.profiles as any;

        
        // A1: Auto-link contact through deal - Priority: payment.profile -> order.profile
        const orderProfile = order?.profiles as any;
        const profile = directProfile || orderProfile || null;
        const effectiveProfileId = p.profile_id || order?.profile_id || null;
        
        const providerResponse = p.provider_response as any;
        const refunds = (p.refunds || []) as any[];
        const docResolved = resolveDocumentUrl(p, p.provider || 'bepaid');

        
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
        
        // Check for status override from CSV reconciliation
        const overrideKey = `${provider}:${pUid}`;
        const statusOverride = pUid ? overridesMap.get(overrideKey) : null;
        
        // Normalize DB status for comparison and display
        // Keep original status value but normalize for display purposes
        let dbStatus = p.status || 'pending';
        
        // Apply override if exists
        const effectiveStatus = statusOverride || dbStatus;
        
        // Check if there's a conflict (override differs from original)
        const hasStatusConflict = statusOverride && statusOverride !== dbStatus;
        
        // Extract commission_total from meta (synced from bePaid statement)
        const meta = (p.meta || {}) as any;
        const commission_total = meta?.commission_total ? Number(meta.commission_total) : null;

        // Phase 9-B — Stripe meta extraction (read-only, no normalization).
        // Tolerate both invoice_id/stripe_invoice_id and subscription_id/stripe_subscription_id keys.
        const stripeMeta = (meta?.stripe || {}) as any;
        const stripe_invoice_id =
          stripeMeta?.invoice_id ?? stripeMeta?.stripe_invoice_id ?? null;
        const stripe_subscription_id =
          stripeMeta?.subscription_id ?? stripeMeta?.stripe_subscription_id ?? null;
        const stripe_hosted_invoice_url = stripeMeta?.hosted_invoice_url ?? null;
        const stripe_invoice_pdf = stripeMeta?.invoice_pdf ?? null;
        
        // F13.ADD: Extract bepaid_description with expanded fallback chain
        const bepaid_description = 
          meta?.bepaid_description ??
          providerResponse?.transaction?.description ??
          providerResponse?.transaction?.additional_data?.description ??
          providerResponse?.transaction?.message ??
          providerResponse?.payment?.description ??
          providerResponse?.message ??
          providerResponse?.description ??
          meta?.gateway_message ??
          (pUid ? uidToQueue.get(pUid)?.description : null) ??
          null;
        
        // P0-guard: Build search index ONCE during transformation
        const search_index = buildSearchIndex([
          pUid,
          profile?.email,
          profile?.phone,
          card_holder,
          p.card_last4,
          order?.order_number,
          profile?.full_name,
          p.amount,
          product_name,
          tariff_name,
          purchaseSnapshot?.product_name,
          bepaid_description,
        ]);
        
        return {
          id: p.id,
          uid: pUid || p.id,
          source: 'processed' as PaymentSource,
          rawSource: 'payments_v2' as const,
          transaction_type: (p as any).transaction_type || 'payment',
          status_normalized: effectiveStatus,
          amount: p.amount,
          currency: p.currency,
          paid_at: p.paid_at,
          created_at: p.created_at,
          payment_classification: (p as any).payment_classification || null,
          origin: p.origin || null,
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
          // F13.ADD: effective_* via cross-reference queue → payments_v2
          effective_order_id: p.order_id || (pUid ? uidToQueue.get(pUid)?.matched_order_id : null) || null,
          effective_order_number: p.order_id 
            ? (order?.order_number || null) 
            : (pUid ? uidToQueue.get(pUid)?.order_number : null) || null,
          effective_order_status: p.order_id 
            ? (order?.status || null) 
            : (pUid ? uidToQueue.get(pUid)?.order_status : null) || null,
          effective_deal_source: p.order_id ? 'payment' as const : (pUid && uidToQueue.has(pUid) ? 'queue' as const : 'none' as const),
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
          has_conflict: hasStatusConflict || false,
          provider,
          tracking_id: null,
          provider_response: providerResponse,
          commission_total,
          bepaid_description,
          stripe_invoice_id,
          stripe_subscription_id,
          stripe_hosted_invoice_url,
          stripe_invoice_pdf,
          document_url: docResolved.url,
          document_url_source: docResolved.source,


          search_index,
        };
      });
      
      // Transform queue data - NO STATUS FILTER, show all (pending/failed/refunded)
      const transformedQueue: UnifiedPayment[] = queueData
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
            // F13.ADD: effective_* for queue records
            effective_order_id: q.matched_order_id || order?.id || null,
            effective_order_number: order?.order_number || null,
            effective_order_status: order?.status || null,
            effective_deal_source: (q.matched_order_id || order?.id) ? 'queue' as const : 'none' as const,
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
            commission_total: null, // Queue items don't have commission data
            payment_classification: null, // Queue items don't have classification
            origin: q.source || null, // Use queue source as origin
            bepaid_description: q.description || null,
            stripe_invoice_id: null,
            stripe_subscription_id: null,
            stripe_hosted_invoice_url: null,
            stripe_invoice_pdf: null,
            document_url: q.receipt_url ?? null,
            document_url_source: q.receipt_url ? 'receipt_url' : null,

            // P0-guard: Build search index ONCE during transformation
            search_index: buildSearchIndex([
              q.bepaid_uid,
              q.customer_email,
              q.customer_phone,
              q.card_holder,
              q.card_last4,
              order?.order_number,
              profile?.full_name,
              profile?.email,
              profile?.phone,
              q.amount,
              q.product_name,
              q.description,
            ]),
          };
        });
      
      // Combine and sort by paid_at (newest first)
      const allPayments = [...transformedPayments, ...transformedQueue].sort((a, b) => {
        const dateA = new Date(a.paid_at || a.created_at).getTime();
        const dateB = new Date(b.paid_at || b.created_at).getTime();
        return dateB - dateA;
      });
      
      console.log(`[Unified Payments] Total after dedup: ${allPayments.length} (queue: ${transformedQueue.length}, payments_v2: ${transformedPayments.length})`);
      
      // Calculate stats
      const stats: PaymentsStats = {
        total: allPayments.length,
        inQueue: transformedQueue.length,
        processed: transformedPayments.length,
        withContact: allPayments.filter(p => p.profile_id).length,
        withoutContact: allPayments.filter(p => !p.profile_id).length,
        // F13.ADD: Stats use effective_order_id for accurate deal counting
        withDeal: allPayments.filter(p => p.effective_order_id).length,
        withoutDeal: allPayments.filter(p => !p.effective_order_id).length,
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
        // Use classifyPayment for EXACT match with RPC and Dashboard
        pending: allPayments.filter(p => classifyPayment(p.status_normalized, p.transaction_type, p.amount) === 'pending').length,
        failed: allPayments.filter(p => classifyPayment(p.status_normalized, p.transaction_type, p.amount) === 'failed').length,
        successful: allPayments.filter(p => classifyPayment(p.status_normalized, p.transaction_type, p.amount) === 'successful').length,
        refunded: allPayments.filter(p => classifyPayment(p.status_normalized, p.transaction_type, p.amount) === 'refunded').length,
        cancelled: allPayments.filter(p => classifyPayment(p.status_normalized, p.transaction_type, p.amount) === 'cancelled').length,
      };
      
      return { payments: allPayments, stats };
    },
    staleTime: 30000,
  });

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
