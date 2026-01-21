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

// Removed DoD Debug Stats interface - debug panel has been removed after DoD verification

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
  const { data: payments, isLoading } = useQuery({
    queryKey: ['contact-payments', contactId],
    queryFn: async (): Promise<PaymentItem[]> => {
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

      // 3. Find payments_v2 by card (even if not linked to profile yet)
      let cardPaymentsV2: any[] = [];
      if (linkedCardsNormalized.length > 0) {
        for (const card of linkedCardsNormalized) {
          const hasBrand = !!card.card_brand && card.card_brand.trim().length > 0;
          const last4IsAmbiguousWithinContact = (last4Counts.get(card.card_last4) || 0) > 1;

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

          if (last4IsAmbiguousWithinContact) {
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

      // 4. Get ONLY COMPLETED payments from payment_reconcile_queue (NO pending!)
      let queuePayments: any[] = [];
      
      const { data: directQueuePayments } = await supabase
        .from('payment_reconcile_queue')
        .select(`
          id, bepaid_uid, tracking_id, amount, paid_at, status, transaction_type,
          card_last4, card_brand, matched_order_id, processed_order_id, product_name
        `)
        .eq('matched_profile_id', contactId)
        .eq('status', 'completed')
        .order('paid_at', { ascending: false })
        .limit(100);
      
      queuePayments.push(...(directQueuePayments || []));

      if (linkedCardsNormalized.length > 0) {
        for (const card of linkedCardsNormalized) {
          const hasBrand = !!card.card_brand && card.card_brand.trim().length > 0;
          const last4IsAmbiguousWithinContact = (last4Counts.get(card.card_last4) || 0) > 1;

          if (hasBrand && card.brandVariants.length > 0) {
            const orIlike = card.brandVariants.map((v) => `card_brand.ilike.${v}`).join(',');
            const { data: byCardQueueBrand, error: byCardQueueBrandError } = await supabase
              .from('payment_reconcile_queue')
              .select(`
                id, bepaid_uid, tracking_id, amount, paid_at, status, transaction_type,
                card_last4, card_brand, matched_order_id, processed_order_id, product_name
              `)
              .eq('card_last4', card.card_last4)
              .eq('status', 'completed')
              .or(orIlike)
              .order('paid_at', { ascending: false })
              .limit(50);

            if (!byCardQueueBrandError) {
              queuePayments.push(...(byCardQueueBrand || []));
            }

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

              queuePayments.push(...(byCardQueueNull || []), ...(byCardQueueEmpty || []));
            }
            continue;
          }

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
            queuePayments.push(...(byLast4QueueAnyBrand || []));
          }
        }
      }

      // 5. Mark sources and merge
      const paymentsV2WithSource = [...(directPayments || []), ...cardPaymentsV2].map((p) => ({
        ...p,
        source: 'payments_v2' as const,
      }));
      
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

      // 7. Fetch related orders for product names
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

      return uniquePayments.map(p => ({
        ...p,
        productName: p.product_name || (p.order_id ? ordersMap.get(p.order_id)?.product_name : null),
      })) as PaymentItem[];
    },
    enabled: !!contactId,
  });

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
