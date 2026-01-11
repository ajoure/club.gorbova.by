import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  RefreshCw, AlertTriangle, Eye, Link2, CreditCard, Package, User
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DateFilter } from "@/hooks/useBepaidData";
import { BepaidMapping } from "@/hooks/useBepaidMappings";
import { DealDetailSheet } from "@/components/admin/DealDetailSheet";

interface UnmatchedPaymentsSectionProps {
  dateFilter?: DateFilter;
  mappings: BepaidMapping[];
  onRefresh?: () => void;
}

interface UnmatchedPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  created_at: string;
  bepaid_plan_title: string | null;
  bepaid_description: string | null;
  order_number: string | null;
  order_product_id: string | null;
  order_tariff_id: string | null;
  product_name: string | null;
  tariff_name: string | null;
  profile_name: string | null;
  profile_id: string | null;
  user_id: string | null;
}

export default function UnmatchedPaymentsSection({ 
  dateFilter, 
  mappings,
  onRefresh
}: UnmatchedPaymentsSectionProps) {
  const queryClient = useQueryClient();
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [dealSheetOpen, setDealSheetOpen] = useState(false);

  // Fetch payments that need mapping review
  const { data: unmatchedPayments, isLoading, refetch } = useQuery({
    queryKey: ["unmatched-bepaid-payments", dateFilter, mappings.length],
    queryFn: async () => {
      const fromDate = dateFilter?.from || "2026-01-01";
      
      let query = supabase
        .from("payments_v2")
        .select(`
          id,
          order_id,
          amount,
          currency,
          created_at,
          provider_response,
          user_id
        `)
        .eq("provider", "bepaid")
        .gte("created_at", `${fromDate}T00:00:00Z`)
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (dateFilter?.to) {
        query = query.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }

      const { data: payments, error } = await query;
      if (error) throw error;

      // Get order and profile info
      const orderIds = [...new Set(payments.filter(p => p.order_id).map(p => p.order_id))];
      const userIds = [...new Set(payments.filter(p => p.user_id).map(p => p.user_id))];

      const [ordersResult, profilesResult, productsResult, tariffsResult] = await Promise.all([
        orderIds.length > 0 
          ? supabase.from("orders_v2").select("id, order_number, product_id, tariff_id, user_id").in("id", orderIds)
          : { data: [] },
        userIds.length > 0
          ? supabase.from("profiles").select("id, full_name").in("id", userIds)
          : { data: [] },
        supabase.from("products_v2").select("id, name"),
        supabase.from("tariffs").select("id, name"),
      ]);

      const ordersMap = new Map((ordersResult.data || []).map(o => [o.id, o]));
      const profilesMap = new Map((profilesResult.data || []).map(p => [p.id, p]));
      const productsMap = new Map((productsResult.data || []).map(p => [p.id, p.name]));
      const tariffsMap = new Map((tariffsResult.data || []).map(t => [t.id, t.name]));

      // Create mapping lookup by plan title
      const mappingsByTitle = new Map(mappings.map(m => [m.bepaid_plan_title.toLowerCase(), m]));

      // Process and filter payments
      const result: UnmatchedPayment[] = [];

      for (const payment of payments) {
        const providerResponse = payment.provider_response as Record<string, any> | null;
        const planTitle = providerResponse?.plan?.title || providerResponse?.plan?.name || null;
        const description = providerResponse?.additional_data?.description || providerResponse?.transaction?.description || null;
        
        const order = ordersMap.get(payment.order_id);
        const profile = profilesMap.get(payment.user_id);
        
        // Check if this payment has a mapping that could be applied
        const titleLower = planTitle?.toLowerCase();
        const mapping = titleLower ? mappingsByTitle.get(titleLower) : null;
        
        // Payment is "unmatched" if:
        // 1. Has bePaid plan title but no matching mapping exists, OR
        // 2. Has a mapping but order's product_id/tariff_id don't match the mapping
        let isUnmatched = false;
        let suggestedMapping: BepaidMapping | null = null;

        if (planTitle && !mapping) {
          // No mapping for this plan title
          isUnmatched = true;
        } else if (mapping && order) {
          // Check if order matches the mapping
          if (mapping.product_id && order.product_id !== mapping.product_id) {
            isUnmatched = true;
            suggestedMapping = mapping;
          } else if (mapping.tariff_id && order.tariff_id !== mapping.tariff_id) {
            isUnmatched = true;
            suggestedMapping = mapping;
          }
        } else if (planTitle && !order) {
          // Has plan title but no order
          isUnmatched = true;
        }

        if (isUnmatched) {
          result.push({
            id: payment.id,
            order_id: payment.order_id,
            amount: payment.amount,
            currency: payment.currency,
            created_at: payment.created_at,
            bepaid_plan_title: planTitle,
            bepaid_description: description,
            order_number: order?.order_number || null,
            order_product_id: order?.product_id || null,
            order_tariff_id: order?.tariff_id || null,
            product_name: order?.product_id ? productsMap.get(order.product_id) || null : null,
            tariff_name: order?.tariff_id ? tariffsMap.get(order.tariff_id) || null : null,
            profile_name: profile?.full_name || null,
            profile_id: payment.user_id,
            user_id: order?.user_id || payment.user_id,
          });
        }
      }

      return result;
    },
    enabled: mappings.length > 0,
  });

  // Apply mapping to a specific order
  const applyMappingMutation = useMutation({
    mutationFn: async ({ orderId, productId, tariffId }: { orderId: string; productId: string | null; tariffId: string | null }) => {
      const updates: Record<string, any> = {};
      if (productId) updates.product_id = productId;
      if (tariffId) updates.tariff_id = tariffId;
      
      const { error } = await supabase
        .from("orders_v2")
        .update(updates)
        .eq("id", orderId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Маппинг применён к сделке");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["bepaid-payments"] });
      onRefresh?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleOpenDeal = async (payment: UnmatchedPayment) => {
    if (!payment.order_id) {
      toast.error("У платежа нет связанной сделки");
      return;
    }

    // Fetch full order data
    const { data: order } = await supabase
      .from("orders_v2")
      .select("*")
      .eq("id", payment.order_id)
      .single();
    
    if (order) {
      setSelectedDeal(order);
      setDealSheetOpen(true);
    }
  };

  const handleApplyMapping = (payment: UnmatchedPayment) => {
    if (!payment.order_id || !payment.bepaid_plan_title) return;
    
    const mapping = mappings.find(m => 
      m.bepaid_plan_title.toLowerCase() === payment.bepaid_plan_title?.toLowerCase()
    );
    
    if (mapping && (mapping.product_id || mapping.tariff_id)) {
      applyMappingMutation.mutate({
        orderId: payment.order_id,
        productId: mapping.product_id,
        tariffId: mapping.tariff_id,
      });
    } else {
      toast.error("Не найден подходящий маппинг для этого плана");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!unmatchedPayments || unmatchedPayments.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-amber-500/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-base">Платежи без корректного маппинга</CardTitle>
            </div>
            <Badge variant="secondary">{unmatchedPayments.length}</Badge>
          </div>
          <CardDescription>
            Платежи bePaid, у которых product/tariff в сделке не соответствует маппингу
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[300px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>План bePaid</TableHead>
                  <TableHead>Сделка</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmatchedPayments.map((payment) => {
                  const hasMapping = mappings.some(m => 
                    m.bepaid_plan_title.toLowerCase() === payment.bepaid_plan_title?.toLowerCase()
                  );
                  
                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(payment.created_at), "dd.MM.yyyy", { locale: ru })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {payment.amount} {payment.currency}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium">{payment.bepaid_plan_title || "—"}</span>
                          {payment.bepaid_description && (
                            <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {payment.bepaid_description}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {payment.order_number ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-mono">{payment.order_number}</span>
                            <div className="flex gap-1">
                              {payment.product_name ? (
                                <Badge variant="outline" className="text-xs">{payment.product_name}</Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">Нет продукта</Badge>
                              )}
                            </div>
                          </div>
                        ) : (
                          <Badge variant="destructive" className="text-xs">Нет сделки</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {payment.profile_name ? (
                          <div className="flex items-center gap-1 text-sm">
                            <User className="h-3 w-3 text-muted-foreground" />
                            <span className="truncate max-w-[100px]">{payment.profile_name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {payment.order_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenDeal(payment)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {payment.order_id && hasMapping && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleApplyMapping(payment)}
                                  disabled={applyMappingMutation.isPending}
                                >
                                  <Link2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Применить маппинг к сделке</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Deal Detail Sheet */}
      <DealDetailSheet
        open={dealSheetOpen}
        onOpenChange={(open) => {
          setDealSheetOpen(open);
          if (!open) {
            refetch();
          }
        }}
        deal={selectedDeal}
        profile={selectedDeal ? { id: selectedDeal.user_id, full_name: null, phone: null } : null}
        onDeleted={() => refetch()}
      />
    </>
  );
}
