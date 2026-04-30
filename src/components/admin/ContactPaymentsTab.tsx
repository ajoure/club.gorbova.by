import { useState } from "react";
import { getDealDisplayName, getShortDisplayName } from "@/lib/deals/getDealDisplayName";
import { resolveModuleDisplayMetaBatch } from "@/lib/deals/resolveModuleDisplayMeta";
import { ProductCategoryBadge } from "@/components/ui/ProductCategoryBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, RefreshCw, Loader2, ArrowDownLeft, ArrowUpRight, ExternalLink, Layers } from "lucide-react";

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

  // Fetch payments for this contact - ONLY from payments_v2 (queue is fully materialized)
  // By profile_id AND by linked cards
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
        .in('status', ['succeeded', 'refunded', 'failed'])
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
              .in('status', ['succeeded', 'refunded', 'failed'])
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
                  .in('status', ['succeeded', 'refunded', 'failed'])
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
                  .in('status', ['succeeded', 'refunded', 'failed'])
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
            .in('status', ['succeeded', 'refunded', 'failed'])
            .order('paid_at', { ascending: false })
            .limit(50);
          if (!byLast4AnyBrandError) cardPaymentsV2.push(...(byLast4AnyBrand || []));
        }
      }

      // 4. Merge all and deduplicate by id
      const allPayments = [...(directPayments || []), ...cardPaymentsV2];
      const uniquePaymentsMap = new Map(allPayments.map(p => [p.id, p]));
      const uniquePayments = Array.from(uniquePaymentsMap.values())
        .sort((a, b) => new Date(b.paid_at || 0).getTime() - new Date(a.paid_at || 0).getTime())
        .slice(0, 100);

      // 5. Fetch related orders for product names
      const orderIds = uniquePayments
        .filter(p => p.order_id)
        .map(p => p.order_id!);

      let ordersMap = new Map<string, { id: string; product_name: string | null; category: string | null; _is_module_standalone: boolean; _missing_display_name: boolean }>();
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders_v2')
          .select('id, product_id, purchase_snapshot, products_v2(name, category)')
          .in('id', orderIds);

        // Resolve module display meta
        const moduleMeta = await resolveModuleDisplayMetaBatch(
          (orders || []).map(o => ({ id: o.id, purchase_snapshot: o.purchase_snapshot as unknown }))
        );

        ordersMap = new Map((orders || []).map(o => {
          const snapshot = o.purchase_snapshot as any;
          const fkName = (o.products_v2 as any)?.name || null;
          const category = (o.products_v2 as any)?.category || null;
          const meta = moduleMeta.get(o.id);
          const rawName = getDealDisplayName({ productName: fkName, purchaseSnapshot: snapshot, moduleProduct: meta?.moduleProduct, fallback: "" });
          const resolvedName = getShortDisplayName(rawName, category);
          const isModuleStandalone = snapshot?.historical_purchase_type === 'module_only_standalone';
          const missingDisplayName = isModuleStandalone && !snapshot?.display_purchase_name && !meta?.moduleProduct;
          return [
            o.id, 
            { id: o.id, product_name: resolvedName, category, _is_module_standalone: isModuleStandalone, _missing_display_name: missingDisplayName }
          ];
        }));
      }

      return uniquePayments.map(p => {
        const orderInfo = p.order_id ? ordersMap.get(p.order_id) : null;
        return {
          ...p,
          productName: orderInfo?.product_name || null,
          category: orderInfo?.category || null,
          _is_module_standalone: orderInfo?._is_module_standalone || false,
          _missing_display_name: orderInfo?._missing_display_name || false,
        };
      }) as PaymentItem[];
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
        return <Badge variant="default" className="text-xs">Успешно</Badge>;
      case 'refunded':
        return <Badge variant="secondary" className="text-xs">Возврат</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="text-xs">Ошибка оплаты</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold flex items-center gap-2 min-w-0">
          <CreditCard className="w-5 h-5 shrink-0" />
          <span className="truncate">Платежи</span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {linkedCards && linkedCards.length > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
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
            <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Платежи не найдены</p>
            <p className="text-xs mt-1">
              {linkedCards && linkedCards.length > 0 
                ? 'Нет платежей по добавленным картам' 
                : 'Нет платежей'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground mb-2">
            Найдено платежей: {payments.length}
          </div>
          {payments.map((payment) => (
            <Card key={payment.id} className="hover:bg-muted/50 transition-colors">
              <CardContent className="py-3 px-3 sm:px-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 min-w-0">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className="shrink-0 mt-0.5">{getTransactionIcon(payment.transaction_type)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium whitespace-nowrap">
                          {payment.amount ? `${payment.amount.toLocaleString('ru-RU')} BYN` : '—'}
                        </span>
                        {getStatusBadge(payment.status)}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span>{getTransactionLabel(payment.transaction_type)}</span>
                        {payment.paid_at && (
                          <>
                            <span>•</span>
                            <span className="whitespace-nowrap">
                              {format(new Date(payment.paid_at), 'dd MMM yyyy, HH:mm', { locale: ru })}
                            </span>
                          </>
                        )}
                        {payment.card_last4 && (
                          <>
                            <span>•</span>
                            <span className="font-mono whitespace-nowrap">****{payment.card_last4}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap min-w-0 sm:justify-end sm:shrink-0">
                    {payment.productName && (
                      <Badge variant="outline" className="text-xs gap-1 max-w-full sm:max-w-[200px] min-w-0">
                        <ProductCategoryBadge category={(payment as any).category} />
                        <Layers className="w-3 h-3 shrink-0 text-indigo-500" />
                        <span className="truncate">{payment.productName}</span>
                      </Badge>
                    )}
                    {(payment as any)._missing_display_name && (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400 bg-amber-50">⚠ Historical name missing</Badge>
                    )}
                    {payment.order_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 shrink-0"
                        onClick={() => window.open(`/admin/orders/${payment.order_id}`, '_blank')}
                        title="Открыть заказ"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
