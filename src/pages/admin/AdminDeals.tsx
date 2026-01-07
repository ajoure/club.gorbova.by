import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Search,
  Handshake,
  RefreshCw,
  Filter,
  Package,
  CreditCard,
  Clock,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Upload,
  Sparkles,
  Trash2,
} from "lucide-react";
import { DealDetailSheet } from "@/components/admin/DealDetailSheet";
import { SmartImportWizard } from "@/components/integrations/SmartImportWizard";

type DealStatus = "all" | "draft" | "pending" | "paid" | "partial" | "cancelled" | "refunded" | "expired";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Черновик", color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/20 text-amber-600", icon: Clock },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
  partial: { label: "Частично оплачен", color: "bg-blue-500/20 text-blue-600", icon: AlertTriangle },
  cancelled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  refunded: { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: XCircle },
  expired: { label: "Истёк", color: "bg-muted text-muted-foreground", icon: XCircle },
};

export default function AdminDeals() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DealStatus>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const queryClient = useQueryClient();

  // Fetch deals (orders_v2) with related data
  const { data: deals, isLoading, refetch } = useQuery({
    queryKey: ["admin-deals", statusFilter, productFilter],
    queryFn: async () => {
      let query = supabase
        .from("orders_v2")
        .select(`
          *,
          products_v2(id, name, code),
          tariffs(id, name, code, access_days),
          flows(id, name),
          payments_v2(id, status, amount, paid_at)
        `)
        .order("created_at", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as any);
      }
      if (productFilter !== "all") {
        query = query.eq("product_id", productFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Fetch products for filter
  const { data: products } = useQuery({
    queryKey: ["products-filter"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true);
      return data || [];
    },
  });

  // Fetch profiles for contact info
  const { data: profilesMap } = useQuery({
    queryKey: ["profiles-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, email, full_name, phone");
      const map = new Map<string, any>();
      data?.forEach(p => map.set(p.user_id, p));
      return map;
    },
  });

  // Calculate stats
  const stats = useMemo(() => {
    if (!deals) return { total: 0, paid: 0, pending: 0, revenue: 0 };
    const total = deals.length;
    const paid = deals.filter(d => d.status === "paid").length;
    const pending = deals.filter(d => d.status === "pending").length;
    const revenue = deals
      .filter(d => d.status === "paid")
      .reduce((sum, d) => sum + Number(d.final_price || 0), 0);
    return { total, paid, pending, revenue };
  }, [deals]);

  // Filter deals
  const filteredDeals = useMemo(() => {
    if (!deals) return [];
    if (!search) return deals;
    
    const searchLower = search.toLowerCase();
    return deals.filter(deal => {
      const profile = profilesMap?.get(deal.user_id);
      return (
        deal.order_number?.toLowerCase().includes(searchLower) ||
        deal.customer_email?.toLowerCase().includes(searchLower) ||
        deal.customer_phone?.includes(search) ||
        profile?.email?.toLowerCase().includes(searchLower) ||
        profile?.full_name?.toLowerCase().includes(searchLower) ||
        (deal.products_v2 as any)?.name?.toLowerCase().includes(searchLower)
      );
    });
  }, [deals, search, profilesMap]);

  const selectedDeal = deals?.find(d => d.id === selectedDealId);

  // Bulk delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // First delete related payments
      const { error: paymentsError } = await supabase
        .from("payments_v2")
        .delete()
        .in("order_id", ids);
      
      if (paymentsError) {
        console.error("Error deleting payments:", paymentsError);
      }

      // Then delete orders
      const { error } = await supabase
        .from("orders_v2")
        .delete()
        .in("id", ids);
      
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Удалено ${count} сделок`);
      setSelectedDealIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
    },
    onError: (error) => {
      toast.error("Ошибка удаления: " + (error as Error).message);
    },
  });

  const handleSelectAll = () => {
    if (selectedDealIds.size === filteredDeals.length) {
      setSelectedDealIds(new Set());
    } else {
      setSelectedDealIds(new Set(filteredDeals.map(d => d.id)));
    }
  };

  const handleSelectDeal = (id: string) => {
    const newSelected = new Set(selectedDealIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedDealIds(newSelected);
  };

  const handleBulkDelete = () => {
    deleteMutation.mutate(Array.from(selectedDealIds));
    setShowDeleteDialog(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Handshake className="h-6 w-6" />
            Сделки
          </h1>
          <p className="text-muted-foreground">Все заказы, подписки, триалы и ручные выдачи</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowImportWizard(true)}>
            <Sparkles className="h-4 w-4 mr-2" />
            Умный импорт
          </Button>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Всего сделок
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Оплачено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.paid}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              Ожидает оплаты
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Выручка
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat("ru-BY", { style: "currency", currency: "BYN" }).format(stats.revenue)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по номеру, email, телефону, продукту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DealStatus)}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([value, { label }]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-[200px]">
            <Package className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Продукт" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все продукты</SelectItem>
            {products?.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats line & bulk actions */}
      <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>Найдено: <strong className="text-foreground">{filteredDeals.length}</strong></span>
        {selectedDealIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span>Выбрано: <strong className="text-foreground">{selectedDealIds.size}</strong></span>
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Удалить выбранные
            </Button>
          </div>
        )}
      </div>

      {/* Deals Table */}
      <GlassCard className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !filteredDeals.length ? (
          <div className="p-12 text-center text-muted-foreground">
            <Handshake className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>Сделки не найдены</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={filteredDeals.length > 0 && selectedDealIds.size === filteredDeals.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Продукт / Тариф</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Оплата</TableHead>
                <TableHead>Доступ до</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeals.map((deal) => {
                const profile = profilesMap?.get(deal.user_id);
                const statusConfig = STATUS_CONFIG[deal.status] || { label: deal.status, color: "bg-muted", icon: Clock };
                const StatusIcon = statusConfig.icon;
                const payments = (deal.payments_v2 as any[]) || [];
                const paidPayments = payments.filter(p => p.status === "paid");

                return (
                  <TableRow 
                    key={deal.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedDealId(deal.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedDealIds.has(deal.id)}
                        onCheckedChange={() => handleSelectDeal(deal.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        {format(new Date(deal.created_at), "dd.MM.yy")}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {deal.order_number}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {profile?.full_name || deal.customer_email || "—"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {profile?.email || deal.customer_email || "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{(deal.products_v2 as any)?.name || "—"}</div>
                          {deal.tariffs && (
                            <div className="text-xs text-muted-foreground">{(deal.tariffs as any)?.name}</div>
                          )}
                        </div>
                      </div>
                      {deal.is_trial && (
                        <Badge variant="outline" className="text-xs mt-1 text-blue-600 border-blue-500/30">Trial</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">
                        {new Intl.NumberFormat("ru-BY", { style: "currency", currency: deal.currency }).format(Number(deal.final_price))}
                      </div>
                      {deal.discount_percent && Number(deal.discount_percent) > 0 && (
                        <div className="text-xs text-green-600">-{deal.discount_percent}%</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusConfig.color}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusConfig.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {paidPayments.length > 0 ? (
                        <div className="flex items-center gap-1.5 text-sm">
                          <CreditCard className="h-3 h-3 text-green-600" />
                          <span>{paidPayments.length} платеж{paidPayments.length > 1 ? "а" : ""}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {deal.trial_end_at ? (
                        <div className="text-sm">
                          {format(new Date(deal.trial_end_at), "dd.MM.yy")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Deal Detail Sheet */}
      <DealDetailSheet
        deal={selectedDeal || null}
        profile={selectedDeal ? profilesMap?.get(selectedDeal.user_id) : null}
        open={!!selectedDealId}
        onOpenChange={(open) => !open && setSelectedDealId(null)}
      />

      {/* Smart Import Wizard */}
      <SmartImportWizard
        open={showImportWizard}
        onOpenChange={setShowImportWizard}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сделки?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить {selectedDealIds.size} сделок? 
              Также будут удалены все связанные платежи. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
