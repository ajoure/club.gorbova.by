import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, RefreshCw, Loader2, ArrowDownLeft, ArrowUpRight, ExternalLink, Package } from "lucide-react";

interface ContactPaymentsTabProps {
  contactId: string;
  userId?: string | null;
}

interface PaymentItem {
  id: string;
  provider_payment_id: string | null;
  amount: number | null;
  paid_at: string | null;
  status: string;
  transaction_type: string | null;
  card_last4: string | null;
  card_brand: string | null;
  order_id: string | null;
  productName?: string | null;
  source?: 'payments_v2' | 'queue'; // Track data source for transparency
}

// Debug stats for DoD verification
interface DebugStats {
  paymentsV2Direct: number;
  paymentsV2ByCard: number;
  queueDirect: number;
  queueByCard: number;
  totalUnique: number;
  queryTimestamp: string;

  // DoD proof: show what cards we attempted to match + a couple of examples per bucket
  matchedCards: Array<{ last4: string; brand: string | null; variants: string[] }>;
  collisionLast4InContact: string[]; // last4 values that are ambiguous within THIS contact
  paymentsV2DirectExamples: Array<Pick<PaymentItem, 'id' | 'paid_at' | 'amount' | 'card_last4' | 'card_brand' | 'status'> & { source: 'payments_v2' }>;
  paymentsV2ByCardExamples: Array<Pick<PaymentItem, 'id' | 'paid_at' | 'amount' | 'card_last4' | 'card_brand' | 'status'> & { source: 'payments_v2' }>;
  queueDirectExamples: Array<Pick<PaymentItem, 'id' | 'paid_at' | 'amount' | 'card_last4' | 'card_brand' | 'status'> & { source: 'queue' }>;
  queueByCardExamples: Array<Pick<PaymentItem, 'id' | 'paid_at' | 'amount' | 'card_last4' | 'card_brand' | 'status'> & { source: 'queue' }>;
}

// Helper: get brand variants for matching (handles master vs mastercard)
function getBrandVariants(brand: string): string[] {
  const normalized = (brand || 'unknown').toLowerCase().trim();
  const variants = [normalized];
  
  if (normalized === 'mastercard' || normalized === 'master' || normalized === 'mc') {
    variants.push('mastercard', 'master', 'mc');
  } else if (normalized === 'belkart' || normalized === 'belcard') {
    variants.push('belkart', 'belcard');
  }
  
  return [...new Set(variants.filter(Boolean))];
}

export function ContactPaymentsTab({ contactId, userId }: ContactPaymentsTabProps) {
  const queryClient = useQueryClient();
  const [isRelinking, setIsRelinking] = useState(false);

  // Fetch contact's linked cards
  const { data: linkedCards } = useQuery({
    queryKey: ['contact-linked-cards', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('card_profile_links')
        .select('card_last4, card_brand')
        .eq('profile_id', contactId);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch payments for this contact - BOTH by profile_id AND by linked cards
  // Also includes payment_reconcile_queue for completed transactions not yet in payments_v2
  // STRICT: Only succeeded/refunded from payments_v2, only completed from queue (NO pending)
  const { data: paymentsData, isLoading } = useQuery({
    queryKey: ['contact-payments', contactId],
    queryFn: async (): Promise<{ payments: PaymentItem[]; debug: DebugStats }> => {
      const queryTimestamp = new Date().toISOString();
      
      // 1. Get linked cards for this contact first
      const { data: cards } = await supabase
        .from('card_profile_links')
        .select('card_last4, card_brand')
        .eq('profile_id', contactId);

      // 2. Get payments directly linked to profile_id from payments_v2
      const { data: directPayments, error } = await supabase
        .from('payments_v2')
        .select(`
          id, provider_payment_id, amount, paid_at, status, transaction_type, 
          card_last4, card_brand, order_id
        `)
        .eq('profile_id', contactId)
        .in('status', ['succeeded', 'refunded'])
        .order('paid_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      
      const paymentsV2DirectCount = directPayments?.length || 0;

       // Prep: normalize linked cards and detect last4 collisions *within this contact*
       const linkedCardsNormalized = (cards || []).map((c) => {
         const rawBrand = (c.card_brand ?? '').toString();
         const normalizedVariants = getBrandVariants(rawBrand || 'unknown')
           .map((v) => (v || '').toLowerCase().trim())
           .filter(Boolean);
         return {
           card_last4: c.card_last4,
           card_brand: rawBrand,
           brandVariants: normalizedVariants,
         };
       });

       const last4Counts = new Map<string, number>();
       for (const c of linkedCardsNormalized) {
         last4Counts.set(c.card_last4, (last4Counts.get(c.card_last4) || 0) + 1);
       }
       const collisionLast4InContact = Array.from(last4Counts.entries())
         .filter(([, cnt]) => cnt > 1)
         .map(([last4]) => last4);

       const matchedCards = linkedCardsNormalized.map((c) => ({
         last4: c.card_last4,
         brand: c.card_brand || null,
         variants: c.brandVariants,
       }));

       // 3. Find payments_v2 by card (even if not linked to profile yet)
       // FIX: make brand matching tolerant to case + allow NULL/empty brands in payment rows.
       // IMPORTANT: last4-only fallback is ONLY allowed for cards that are already linked to THIS contact.
       let cardPaymentsV2: any[] = [];
       if (linkedCardsNormalized.length > 0) {
         for (const card of linkedCardsNormalized) {
           const hasBrand = !!card.card_brand && card.card_brand.trim().length > 0;
           const last4IsAmbiguousWithinContact = (last4Counts.get(card.card_last4) || 0) > 1;

           // 3a) Variant / case-insensitive brand match
           if (hasBrand && card.brandVariants.length > 0) {
             const orIlike = card.brandVariants.map((v) => `card_brand.ilike.${v}`).join(',');
             const { data: byCardBrand, error: byCardBrandError } = await supabase
               .from('payments_v2')
               .select(`
                 id, provider_payment_id, amount, paid_at, status, transaction_type,
                 card_last4, card_brand, order_id
               `)
               .eq('card_last4', card.card_last4)
               .in('status', ['succeeded', 'refunded'])
               .or(orIlike)
               .order('paid_at', { ascending: false })
               .limit(50);

             if (!byCardBrandError) cardPaymentsV2.push(...(byCardBrand || []));

             // 3b) Include rows where payment brand is missing (NULL/empty)
             // Guard: if the contact has multiple cards with same last4, do NOT last4-only match.
             if (!last4IsAmbiguousWithinContact) {
               const [{ data: byCardNull }, { data: byCardEmpty }] = await Promise.all([
                 supabase
                   .from('payments_v2')
                   .select(`
                     id, provider_payment_id, amount, paid_at, status, transaction_type,
                     card_last4, card_brand, order_id
                   `)
                   .eq('card_last4', card.card_last4)
                   .in('status', ['succeeded', 'refunded'])
                   .is('card_brand', null)
                   .order('paid_at', { ascending: false })
                   .limit(50),
                 supabase
                   .from('payments_v2')
                   .select(`
                     id, provider_payment_id, amount, paid_at, status, transaction_type,
                     card_last4, card_brand, order_id
                   `)
                   .eq('card_last4', card.card_last4)
                   .in('status', ['succeeded', 'refunded'])
                   .eq('card_brand', '')
                   .order('paid_at', { ascending: false })
                   .limit(50),
               ]);
               cardPaymentsV2.push(...(byCardNull || []), ...(byCardEmpty || []));
             }
             continue;
           }

           // 3c) Brand unknown/empty on linked card → allow last4-only matching, but ONLY within this contact.
           if (last4IsAmbiguousWithinContact) {
             // STOP: ambiguous within the contact itself; don't attempt last4-only.
             continue;
           }

           const { data: byLast4AnyBrand, error: byLast4AnyBrandError } = await supabase
             .from('payments_v2')
             .select(`
               id, provider_payment_id, amount, paid_at, status, transaction_type,
               card_last4, card_brand, order_id
             `)
             .eq('card_last4', card.card_last4)
             .in('status', ['succeeded', 'refunded'])
             .order('paid_at', { ascending: false })
             .limit(50);
           if (!byLast4AnyBrandError) cardPaymentsV2.push(...(byLast4AnyBrand || []));
         }
       }
      
      const paymentsV2ByCardCount = cardPaymentsV2.length;

       // 4. Get ONLY COMPLETED payments from payment_reconcile_queue (NO pending!)
      // These are transactions that succeeded but haven't been moved to payments_v2 yet
      let queuePayments: any[] = [];
      
      // 4a. Direct match by matched_profile_id - ONLY completed
       // NOTE: payment_reconcile_queue does NOT have provider_payment_id/order_id columns.
       const { data: directQueuePayments } = await supabase
        .from('payment_reconcile_queue')
        .select(`
           id, bepaid_uid, tracking_id, amount, paid_at, status, transaction_type,
           card_last4, card_brand, matched_order_id, processed_order_id, product_name
        `)
        .eq('matched_profile_id', contactId)
        .eq('status', 'completed') // STRICT: only completed, not pending
        .order('paid_at', { ascending: false })
        .limit(100);
      
      const queueDirectCount = directQueuePayments?.length || 0;
      queuePayments.push(...(directQueuePayments || []));

      // 4b. Match by card - ONLY completed
      let queueByCardCount = 0;
       if (linkedCardsNormalized.length > 0) {
         for (const card of linkedCardsNormalized) {
           const hasBrand = !!card.card_brand && card.card_brand.trim().length > 0;
           const last4IsAmbiguousWithinContact = (last4Counts.get(card.card_last4) || 0) > 1;

           // 4b-1) Variant / case-insensitive brand match
           if (hasBrand && card.brandVariants.length > 0) {
             const orIlike = card.brandVariants.map((v) => `card_brand.ilike.${v}`).join(',');
             const { data: byCardQueueBrand, error: byCardQueueBrandError } = await supabase
               .from('payment_reconcile_queue')
               .select(`
                 id, bepaid_uid, tracking_id, amount, paid_at, status, transaction_type,
                 card_last4, card_brand, matched_order_id, processed_order_id, product_name
               `)
               .eq('card_last4', card.card_last4)
               .eq('status', 'completed') // STRICT: only completed
               .or(orIlike)
               .order('paid_at', { ascending: false })
               .limit(50);

             if (!byCardQueueBrandError) {
               queueByCardCount += byCardQueueBrand?.length || 0;
               queuePayments.push(...(byCardQueueBrand || []));
             }

             // 4b-2) Include NULL/empty brands in queue rows (guarded)
             if (!last4IsAmbiguousWithinContact) {
               const [{ data: byCardQueueNull }, { data: byCardQueueEmpty }] = await Promise.all([
                 supabase
                   .from('payment_reconcile_queue')
                   .select(`
                     id, bepaid_uid, tracking_id, amount, paid_at, status, transaction_type,
                     card_last4, card_brand, matched_order_id, processed_order_id, product_name
                   `)
                   .eq('card_last4', card.card_last4)
                   .eq('status', 'completed')
                   .is('card_brand', null)
                   .order('paid_at', { ascending: false })
                   .limit(50),
                 supabase
                   .from('payment_reconcile_queue')
                   .select(`
                     id, bepaid_uid, tracking_id, amount, paid_at, status, transaction_type,
                     card_last4, card_brand, matched_order_id, processed_order_id, product_name
                   `)
                   .eq('card_last4', card.card_last4)
                   .eq('status', 'completed')
                   .eq('card_brand', '')
                   .order('paid_at', { ascending: false })
                   .limit(50),
               ]);

               const extra = [...(byCardQueueNull || []), ...(byCardQueueEmpty || [])];
               queueByCardCount += extra.length;
               queuePayments.push(...extra);
             }
             continue;
           }

           // 4b-3) Brand unknown/empty on linked card → allow last4-only match ONLY if unambiguous within contact
           if (last4IsAmbiguousWithinContact) {
             continue;
           }

           const { data: byLast4QueueAnyBrand, error: byLast4QueueAnyBrandError } = await supabase
             .from('payment_reconcile_queue')
             .select(`
               id, bepaid_uid, tracking_id, amount, paid_at, status, transaction_type,
               card_last4, card_brand, matched_order_id, processed_order_id, product_name
             `)
             .eq('card_last4', card.card_last4)
             .eq('status', 'completed')
             .order('paid_at', { ascending: false })
             .limit(50);

           if (!byLast4QueueAnyBrandError) {
             queueByCardCount += byLast4QueueAnyBrand?.length || 0;
             queuePayments.push(...(byLast4QueueAnyBrand || []));
           }
         }
       }

      // 5. Mark sources and merge
       const paymentsV2WithSource = [...(directPayments || []), ...cardPaymentsV2].map((p) => ({
         ...p,
         source: 'payments_v2' as const,
       }));
      
       // Normalize queue rows to look like PaymentItem as close as possible
       const queueWithSource = queuePayments.map((p) => ({
         ...p,
         provider_payment_id: p.bepaid_uid || p.tracking_id || p.id,
         order_id: p.matched_order_id || p.processed_order_id || null,
         source: 'queue' as const,
       }));

      // 6. Merge all sources and deduplicate by id
      const allPayments = [...paymentsV2WithSource, ...queueWithSource];
      const uniquePaymentsMap = new Map(allPayments.map(p => [p.id, p]));
      const uniquePayments = Array.from(uniquePaymentsMap.values())
        .sort((a, b) => new Date(b.paid_at || 0).getTime() - new Date(a.paid_at || 0).getTime())
        .slice(0, 100);

      // 7. Fetch related orders for product names (for payments_v2 entries)
      const orderIds = uniquePayments
        .filter(p => p.order_id && !p.product_name)
        .map(p => p.order_id!);

      let ordersMap = new Map<string, { id: string; product_name: string | null }>();
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders_v2')
          .select('id, product_id, products_v2(name)')
          .in('id', orderIds);
        ordersMap = new Map((orders || []).map(o => [
          o.id, 
          { id: o.id, product_name: (o.products_v2 as any)?.name || null }
        ]));
      }

      const finalPayments = uniquePayments.map(p => ({
        ...p,
        productName: p.product_name || (p.order_id ? ordersMap.get(p.order_id)?.product_name : null),
      })) as PaymentItem[];

       type DebugExampleBase = Pick<PaymentItem, 'id' | 'paid_at' | 'amount' | 'card_last4' | 'card_brand' | 'status'>;
       const makeExamples = <S extends 'payments_v2' | 'queue'>(
         items: any[],
         source: S
       ): Array<DebugExampleBase & { source: S }> =>
         (items || []).slice(0, 2).map((p) => ({
           id: p.id,
           paid_at: p.paid_at,
           amount: p.amount,
           card_last4: p.card_last4,
           card_brand: p.card_brand,
           status: p.status,
           source,
         }));

       return {
         payments: finalPayments,
         debug: {
           paymentsV2Direct: paymentsV2DirectCount,
           paymentsV2ByCard: paymentsV2ByCardCount,
           queueDirect: queueDirectCount,
           queueByCard: queueByCardCount,
           totalUnique: finalPayments.length,
           queryTimestamp,

           matchedCards,
           collisionLast4InContact,
           paymentsV2DirectExamples: makeExamples(directPayments || [], 'payments_v2'),
           paymentsV2ByCardExamples: makeExamples(cardPaymentsV2 || [], 'payments_v2'),
           queueDirectExamples: makeExamples(directQueuePayments || [], 'queue'),
           queueByCardExamples: makeExamples(queuePayments || [], 'queue'),
         },
       };
    },
    enabled: !!contactId,
  });
  
  // Extract payments and debug from query result
  const payments = paymentsData?.payments;
  const debugStats = paymentsData?.debug;

  // Handle re-autolink for all linked cards
  const handleReautolink = async () => {
    if (!linkedCards || linkedCards.length === 0) {
      toast.info('Нет привязанных карт');
      return;
    }

    setIsRelinking(true);
    let totalLinked = 0;

    try {
      for (const card of linkedCards) {
        const { data: result, error } = await supabase.functions.invoke('payments-autolink-by-card', {
          body: {
            profile_id: contactId,
            card_last4: card.card_last4,
            card_brand: card.card_brand || 'unknown',
            dry_run: false,
            limit: 200,
          }
        });

        if (error) {
          console.warn('Autolink error for card:', card.card_last4, error);
          continue;
        }

        const updated = (result?.stats?.updated_payments_profile || 0) + 
                        (result?.stats?.updated_queue_profile || 0);
        totalLinked += updated;
      }

      if (totalLinked > 0) {
        toast.success(`Привязано ${totalLinked} платежей`);
        queryClient.invalidateQueries({ queryKey: ['contact-payments', contactId] });
        queryClient.invalidateQueries({ queryKey: ['unified-payments'] });
      } else {
        toast.info('Нет платежей для привязки');
      }
    } catch (e: any) {
      console.error('Reautolink error:', e);
      toast.error('Ошибка перепривязки: ' + e.message);
    } finally {
      setIsRelinking(false);
    }
  };

  const getTransactionIcon = (type: string | null) => {
    if (type === 'refund' || type === 'Возврат средств') {
      return <ArrowDownLeft className="w-4 h-4 text-orange-500" />;
    }
    return <ArrowUpRight className="w-4 h-4 text-green-500" />;
  };

  const getTransactionLabel = (type: string | null) => {
    if (type === 'refund' || type === 'Возврат средств') return 'Возврат';
    return 'Оплата';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'succeeded':
      case 'completed': // from payment_reconcile_queue - treated as succeeded
        return <Badge variant="default" className="text-xs">Успешно</Badge>;
      case 'refunded':
        return <Badge variant="secondary" className="text-xs">Возврат</Badge>;
      // NOTE: pending is NO LONGER shown per ТЗ requirements
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };
  
  // Source badge for transparency
  const getSourceBadge = (source?: 'payments_v2' | 'queue') => {
    if (source === 'queue') {
      return <Badge variant="outline" className="text-xs ml-1 text-orange-600 border-orange-300">Очередь</Badge>;
    }
    return null; // payments_v2 is default, no badge needed
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with re-autolink button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Платежи
        </h3>
        <div className="flex items-center gap-2">
          {linkedCards && linkedCards.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {linkedCards.length} карт{linkedCards.length === 1 ? 'а' : linkedCards.length < 5 ? 'ы' : ''}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReautolink}
            disabled={isRelinking || !linkedCards?.length}
          >
            {isRelinking ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Перепривязать
          </Button>
        </div>
      </div>

       {/* DoD DEBUG PANEL - proof for DoD: shows matching attempts + a couple of example rows */}
      {debugStats && (
        <Card className="border-dashed border-blue-300 bg-blue-50/50">
          <CardContent className="py-3">
            <div className="text-xs font-mono space-y-1">
               <div className="font-semibold text-blue-700">📊 DoD Debug Panel (временно)</div>
              <div>payments_v2 (direct profile_id): <strong>{debugStats.paymentsV2Direct}</strong></div>
              <div>payments_v2 (by card match): <strong>{debugStats.paymentsV2ByCard}</strong></div>
              <div>queue (direct matched_profile_id): <strong>{debugStats.queueDirect}</strong></div>
              <div>queue (by card match): <strong>{debugStats.queueByCard}</strong></div>
               <div className="pt-1 border-t border-blue-200">
                 matched_cards:
                 <pre className="whitespace-pre-wrap break-words">{JSON.stringify(debugStats.matchedCards, null, 2)}</pre>
               </div>
               {debugStats.collisionLast4InContact.length > 0 && (
                 <div className="text-orange-700">
                   collision_last4_in_contact: {debugStats.collisionLast4InContact.join(', ')}
                 </div>
               )}
               <div className="pt-1 border-t border-blue-200">
                 examples:
                 <pre className="whitespace-pre-wrap break-words">{JSON.stringify({
                   payments_v2_direct: debugStats.paymentsV2DirectExamples,
                   payments_v2_by_card: debugStats.paymentsV2ByCardExamples,
                   queue_direct: debugStats.queueDirectExamples,
                   queue_by_card: debugStats.queueByCardExamples,
                 }, null, 2)}</pre>
               </div>
              <div className="pt-1 border-t border-blue-200">
                <strong>ИТОГО уникальных: {debugStats.totalUnique}</strong>
              </div>
              <div className="text-muted-foreground">Query: {debugStats.queryTimestamp}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked cards summary */}
      {linkedCards && linkedCards.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-muted-foreground">Привязанные карты</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <div className="flex flex-wrap gap-2">
              {linkedCards.map((card, idx) => (
                <Badge key={idx} variant="outline" className="text-xs gap-1">
                  <CreditCard className="w-3 h-3" />
                  {card.card_brand?.toUpperCase() || 'CARD'} ****{card.card_last4}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payments list */}
      {!payments || payments.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Нет платежей
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {payments.map((payment) => (
            <Card key={payment.id} className="hover:bg-muted/50 transition-colors">
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-4">
                  {/* Left: transaction info */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {getTransactionIcon(payment.transaction_type)}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {payment.amount?.toFixed(2) || '0.00'} BYN
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {getTransactionLabel(payment.transaction_type)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {payment.paid_at && (
                          <span>
                            {format(new Date(payment.paid_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
                          </span>
                        )}
                        {payment.card_last4 && (
                          <span className="flex items-center gap-1">
                            <CreditCard className="w-3 h-3" />
                            ****{payment.card_last4}
                          </span>
                        )}
                      </div>
                      {/* Product name */}
                      {payment.productName && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <Package className="w-3 h-3" />
                          {payment.productName}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: status, source badge and UID */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="flex items-center">
                      {getStatusBadge(payment.status)}
                      {getSourceBadge(payment.source)}
                    </div>
                    {payment.provider_payment_id && (
                      <code className="text-xs text-muted-foreground">
                        {payment.provider_payment_id.slice(0, 12)}...
                      </code>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary */}
      {payments && payments.length > 0 && (
        <div className="text-xs text-muted-foreground text-right">
          Показано: {payments.length} платежей
        </div>
      )}
    </div>
  );
}
