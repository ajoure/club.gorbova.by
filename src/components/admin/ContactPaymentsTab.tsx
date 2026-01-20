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

  // Fetch payments for this contact
  const { data: payments, isLoading } = useQuery({
    queryKey: ['contact-payments', contactId],
    queryFn: async () => {
      // Get payments directly linked to profile_id
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

      // Fetch related orders for product names
      const orderIds = (directPayments || [])
        .filter(p => p.order_id)
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

      return (directPayments || []).map(p => ({
        ...p,
        productName: p.order_id ? ordersMap.get(p.order_id)?.product_name : null,
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
        return <Badge variant="default" className="text-xs">Успешно</Badge>;
      case 'refunded':
        return <Badge variant="secondary" className="text-xs">Возврат</Badge>;
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

                  {/* Right: status and UID */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {getStatusBadge(payment.status)}
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
