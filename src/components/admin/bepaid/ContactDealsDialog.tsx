import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  User, Phone, Mail, Package, CreditCard, RefreshCw,
  CheckCircle, Clock, AlertTriangle, XCircle, Eye
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { DealDetailSheet } from "@/components/admin/DealDetailSheet";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Черновик", color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/20 text-amber-600", icon: Clock },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
  partial: { label: "Частично оплачен", color: "bg-blue-500/20 text-blue-600", icon: AlertTriangle },
  cancelled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  refunded: { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: XCircle },
  expired: { label: "Истёк", color: "bg-muted text-muted-foreground", icon: XCircle },
};

interface Profile {
  id: string;
  user_id?: string | null;
  full_name: string | null;
  email?: string | null;
  phone: string | null;
}

interface ContactDealsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile | null;
  onDealUpdated?: () => void;
}

export default function ContactDealsDialog({ 
  open, 
  onOpenChange, 
  profile,
  onDealUpdated
}: ContactDealsDialogProps) {
  const queryClient = useQueryClient();
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [dealDetailOpen, setDealDetailOpen] = useState(false);

  // Fetch deals for this contact
  const { data: deals, isLoading, refetch } = useQuery({
    queryKey: ["contact-deals", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      
      // Fetch by user_id or profile id
      const userId = profile.user_id || profile.id;
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          id,
          order_number,
          status,
          final_price,
          base_price,
          currency,
          created_at,
          paid_amount,
          product_id,
          tariff_id,
          customer_email,
          customer_phone,
          payer_type,
          user_id
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch product and tariff names
      const productIds = [...new Set(data.filter(d => d.product_id).map(d => d.product_id))];
      const tariffIds = [...new Set(data.filter(d => d.tariff_id).map(d => d.tariff_id))];

      const [productsResult, tariffsResult] = await Promise.all([
        productIds.length > 0 
          ? supabase.from("products_v2").select("id, name").in("id", productIds)
          : { data: [] },
        tariffIds.length > 0
          ? supabase.from("tariffs").select("id, name").in("id", tariffIds)
          : { data: [] },
      ]);

      const productsMap = new Map((productsResult.data || []).map(p => [p.id, p.name]));
      const tariffsMap = new Map((tariffsResult.data || []).map(t => [t.id, t.name]));

      return data.map(deal => ({
        ...deal,
        product_name: productsMap.get(deal.product_id) || null,
        tariff_name: tariffsMap.get(deal.tariff_id) || null,
      }));
    },
    enabled: !!profile && open,
  });

  // Fetch payments for all deals
  const { data: payments } = useQuery({
    queryKey: ["contact-deals-payments", deals?.map(d => d.id).join(",")],
    queryFn: async () => {
      if (!deals || deals.length === 0) return [];
      const { data, error } = await supabase
        .from("payments_v2")
        .select("id, order_id, amount, status, created_at")
        .in("order_id", deals.map(d => d.id))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!deals && deals.length > 0,
  });

  const handleViewDeal = (deal: any) => {
    setSelectedDeal(deal);
    setDealDetailOpen(true);
  };

  const handleDealDetailClosed = (isOpen: boolean) => {
    setDealDetailOpen(isOpen);
    if (!isOpen) {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
      onDealUpdated?.();
    }
  };

  if (!profile) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Сделки контакта
            </DialogTitle>
            <DialogDescription>
              <div className="flex flex-col gap-1 mt-2">
                <span className="font-medium text-foreground">{profile.full_name || "Без имени"}</span>
                <div className="flex items-center gap-4 text-sm">
                  {profile.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {profile.phone}
                    </span>
                  )}
                  {profile.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {profile.email}
                    </span>
                  )}
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : deals && deals.length > 0 ? (
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>№ Заказа</TableHead>
                      <TableHead>Дата</TableHead>
                      <TableHead>Продукт</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Платежи</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deals.map((deal) => {
                      const statusConfig = STATUS_CONFIG[deal.status] || STATUS_CONFIG.pending;
                      const StatusIcon = statusConfig.icon;
                      const dealPayments = payments?.filter(p => p.order_id === deal.id) || [];
                      
                      return (
                        <TableRow key={deal.id} className="cursor-pointer hover:bg-accent/50">
                          <TableCell className="font-mono text-xs">
                            {deal.order_number}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {format(new Date(deal.created_at), "dd.MM.yyyy", { locale: ru })}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              {deal.product_name && (
                                <span className="font-medium text-sm">{deal.product_name}</span>
                              )}
                              {deal.tariff_name && (
                                <Badge variant="secondary" className="text-xs w-fit">
                                  {deal.tariff_name}
                                </Badge>
                              )}
                              {!deal.product_name && !deal.tariff_name && (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-medium">
                                {deal.final_price} {deal.currency}
                              </span>
                              {deal.paid_amount !== null && deal.paid_amount > 0 && deal.paid_amount !== deal.final_price && (
                                <span className="text-xs text-muted-foreground">
                                  Оплачено: {deal.paid_amount} {deal.currency}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={statusConfig.color}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {statusConfig.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {dealPayments.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="gap-1">
                                    <CreditCard className="h-3 w-3" />
                                    {dealPayments.length}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {dealPayments.map((p) => (
                                    <div key={p.id} className="text-xs">
                                      {p.amount} {deal.currency} — {p.status}
                                    </div>
                                  ))}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewDeal(deal)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Открыть
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>У контакта нет сделок</p>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mt-4 pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Всего сделок: {deals?.length || 0}
            </span>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deal Detail Sheet */}
      <DealDetailSheet
        open={dealDetailOpen}
        onOpenChange={handleDealDetailClosed}
        deal={selectedDeal}
        profile={profile}
        onDeleted={() => {
          refetch();
          onDealUpdated?.();
        }}
      />
    </>
  );
}
