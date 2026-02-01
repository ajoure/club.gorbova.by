import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { PreregistrationDetailSheet } from "@/components/admin/PreregistrationDetailSheet";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { getProductName } from "@/lib/product-names";
import {
  Search,
  Download,
  Users,
  Clock,
  CheckCircle,
  MessageSquare,
  RefreshCw,
  AlertTriangle,
  CreditCard,
  XCircle,
} from "lucide-react";

interface PreregistrationBilling {
  billing_status?: 'pending' | 'paid' | 'no_card' | 'failed' | 'overdue';
  attempts_count?: number;
  last_attempt_at?: string;
  last_attempt_window_key?: string;
  last_attempt_status?: 'success' | 'failed' | 'skipped';
  last_attempt_error?: string;
  has_active_card?: boolean;
  notified?: {
    tomorrow_charge_at?: string;
    no_card_at?: string;
    failed_at?: string;
  };
}

interface Preregistration {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  product_code: string;
  tariff_name: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  consent: boolean;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  meta?: {
    billing?: PreregistrationBilling;
  } | null;
  profiles?: {
    id: string;
    full_name: string | null;
    telegram_user_id: number | null;
    telegram_username: string | null;
  } | null;
}

// PATCH-5: Enhanced billing segments with proper terminology
type BillingSegment = 'all' | 'pending' | 'no_card' | 'failed' | 'paid';

// PATCH-5: Removed converted status - only real statuses remain
const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  new: { label: "Новая", variant: "secondary" },
  confirmed: { label: "Подтверждена", variant: "default" },
  contacted: { label: "Связались", variant: "outline" },
  paid: { label: "Оплачено", variant: "default" },
  cancelled: { label: "Отменена", variant: "destructive" },
};

export function PreregistrationsTabContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [selectedPreregistration, setSelectedPreregistration] = useState<Preregistration | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  
  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Billing segment filter
  const [billingFilter, setBillingFilter] = useState<BillingSegment>('all');

  // Fetch preregistrations with meta
  const { data: preregistrations, isLoading, refetch } = useQuery({
    queryKey: ["admin-preregistrations", search, statusFilter, productFilter, billingFilter],
    queryFn: async () => {
      let query = supabase
        .from("course_preregistrations")
        .select("*, meta")
        .order("created_at", { ascending: false });

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
      }

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (productFilter !== "all") {
        query = query.eq("product_code", productFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch profiles for users with user_id
      const userIds = data.filter(p => p.user_id).map(p => p.user_id);
      let profilesMap: Record<string, any> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, user_id, full_name, telegram_user_id, telegram_username")
          .in("user_id", userIds);
        
        if (profiles) {
          profilesMap = profiles.reduce((acc, p) => {
            if (p.user_id) acc[p.user_id] = p;
            return acc;
          }, {} as Record<string, any>);
        }
      }

      let result = data.map(p => ({
        ...p,
        profiles: p.user_id ? profilesMap[p.user_id] || null : null,
      })) as Preregistration[];
      
      // PATCH-5: Enhanced billing segment filters with proper separation
      if (billingFilter === 'pending') {
        // Ожидают списания: new/contacted без billing_status или billing_status = pending
        result = result.filter((p) => {
          const billingStatus = p.meta?.billing?.billing_status;
          return !['paid', 'cancelled'].includes(p.status) &&
                 (!billingStatus || billingStatus === 'pending');
        });
      } else if (billingFilter === 'no_card') {
        // Нет карты
        result = result.filter((p) => {
          const billingStatus = p.meta?.billing?.billing_status;
          return billingStatus === 'no_card';
        });
      } else if (billingFilter === 'failed') {
        // Ошибка списания
        result = result.filter((p) => {
          const billingStatus = p.meta?.billing?.billing_status;
          return billingStatus === 'failed';
        });
      } else if (billingFilter === 'paid') {
        // Оплачено
        result = result.filter((p) => {
          const billingStatus = p.meta?.billing?.billing_status;
          return p.status === 'paid' || billingStatus === 'paid';
        });
      }
      
      return result;
    },
  });

  // PATCH-4: Fetch stats with billing segments - respects productFilter
  const { data: stats } = useQuery({
    queryKey: ["preregistration-stats", productFilter],
    queryFn: async () => {
      let query = supabase
        .from("course_preregistrations")
        .select("status, product_code, meta");
      
      // Apply product filter to stats query
      if (productFilter !== "all") {
        query = query.eq("product_code", productFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const total = data.length;
      const newCount = data.filter((p) => p.status === "new").length;
      const confirmed = data.filter((p) => p.status === "confirmed").length;
      const byProduct = data.reduce((acc, p) => {
        acc[p.product_code] = (acc[p.product_code] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // PATCH-5: Enhanced billing segment counts with proper separation
      const billingPending = data.filter((p) => {
        const billingStatus = (p.meta as any)?.billing?.billing_status;
        return !['paid', 'cancelled'].includes(p.status) &&
               (!billingStatus || billingStatus === 'pending');
      }).length;
      
      const billingNoCard = data.filter((p) => {
        const billingStatus = (p.meta as any)?.billing?.billing_status;
        return billingStatus === 'no_card';
      }).length;
      
      const billingFailed = data.filter((p) => {
        const billingStatus = (p.meta as any)?.billing?.billing_status;
        return billingStatus === 'failed';
      }).length;
      
      const billingPaid = data.filter((p) => {
        const billingStatus = (p.meta as any)?.billing?.billing_status;
        return p.status === 'paid' || billingStatus === 'paid';
      }).length;

      return { total, newCount, confirmed, byProduct, billingPending, billingNoCard, billingFailed, billingPaid };
    },
  });

  // Fetch unique products for filter
  const { data: products } = useQuery({
    queryKey: ["preregistration-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_preregistrations")
        .select("product_code")
        .order("product_code");

      if (error) throw error;
      const unique = [...new Set(data.map((p) => p.product_code))];
      return unique;
    },
  });

  // Bulk delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("course_preregistrations")
        .delete()
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Удалено предзаписей: ${selectedIds.size}`);
      setSelectedIds(new Set());
      setDeleteDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-preregistrations"] });
      queryClient.invalidateQueries({ queryKey: ["preregistration-stats"] });
      queryClient.invalidateQueries({ queryKey: ["preregistration-products"] });
    },
    onError: (error) => {
      console.error("Delete error:", error);
      toast.error("Ошибка удаления");
    },
  });

  // Selection handlers
  const toggleSelection = useCallback((id: string, ctrlKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!ctrlKey) {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (preregistrations) {
      setSelectedIds(new Set(preregistrations.map(p => p.id)));
    }
  }, [preregistrations]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected = preregistrations && preregistrations.length > 0 && selectedIds.size === preregistrations.length;
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  const handleExportCSV = () => {
    if (!preregistrations) return;

    const headers = ["Имя", "Email", "Телефон", "Продукт", "Тариф", "Статус", "Дата", "Источник"];
    const rows = preregistrations.map((p) => [
      p.name,
      p.email,
      p.phone || "",
      getProductName(p.product_code),
      p.tariff_name || "",
      statusConfig[p.status]?.label || p.status,
      format(new Date(p.created_at), "dd.MM.yyyy HH:mm"),
      p.source || "",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `preregistrations_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openDetail = (prereg: Preregistration) => {
    setSelectedPreregistration(prereg);
    setDetailSheetOpen(true);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size > 0) {
      setDeleteDialogOpen(true);
    }
  };

  const confirmDelete = () => {
    deleteMutation.mutate(Array.from(selectedIds));
  };

  return (
    <>
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Всего</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Новых</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.newCount || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Подтверждённых</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.confirmed || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">По продуктам</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xs space-y-1">
                {stats?.byProduct && Object.entries(stats.byProduct).map(([code, count]) => (
                  <div key={code} className="flex justify-between">
                    <span className="text-muted-foreground truncate">{getProductName(code)}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* PATCH-5: Enhanced Billing Segment Tabs with proper terminology */}
        <div className="flex flex-wrap gap-2">
          <Button 
            variant={billingFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBillingFilter('all')}
          >
            Все
          </Button>
          <Button 
            variant={billingFilter === 'pending' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBillingFilter('pending')}
            className="gap-2"
          >
            <Clock className="h-4 w-4" />
            Ожидают списания
            <Badge variant="secondary" className="ml-1">{stats?.billingPending || 0}</Badge>
          </Button>
          <Button 
            variant={billingFilter === 'no_card' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBillingFilter('no_card')}
            className="gap-2"
          >
            <CreditCard className="h-4 w-4 text-yellow-500" />
            Нет карты
            <Badge variant="secondary" className="ml-1">{stats?.billingNoCard || 0}</Badge>
          </Button>
          <Button 
            variant={billingFilter === 'failed' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBillingFilter('failed')}
            className="gap-2"
          >
            <XCircle className="h-4 w-4 text-red-500" />
            Ошибка списания
            <Badge variant="secondary" className="ml-1">{stats?.billingFailed || 0}</Badge>
          </Button>
          <Button 
            variant={billingFilter === 'paid' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBillingFilter('paid')}
            className="gap-2"
          >
            <CheckCircle className="h-4 w-4 text-green-500" />
            Оплаченные
            <Badge variant="secondary" className="ml-1">{stats?.billingPaid || 0}</Badge>
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по имени, email, телефону..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  {Object.entries(statusConfig).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="Продукт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все продукты</SelectItem>
                  {products?.map((code) => (
                    <SelectItem key={code} value={code}>
                      {getProductName(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Обновить
              </Button>
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              {/* PATCH-3: Added Card/Attempts/Last Attempt/TG/Email columns like AutoRenewals */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={isAllSelected}
                        ref={(ref) => {
                          if (ref) {
                            (ref as any).indeterminate = isSomeSelected;
                          }
                        }}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            selectAll();
                          } else {
                            clearSelection();
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead>Имя</TableHead>
                    <TableHead>Контакты</TableHead>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-center">Карта</TableHead>
                    <TableHead className="text-center">Попытки</TableHead>
                    <TableHead>Last Attempt</TableHead>
                    <TableHead className="text-center">TG</TableHead>
                    <TableHead className="text-center">Email</TableHead>
                    <TableHead>Дата</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={11}>
                          <Skeleton className="h-10 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : preregistrations && preregistrations.length > 0 ? (
                  preregistrations.map((prereg) => {
                      const status = statusConfig[prereg.status] || { label: prereg.status, variant: "secondary" as const };
                      const isSelected = selectedIds.has(prereg.id);
                      const billing = prereg.meta?.billing;
                      const hasCard = billing?.has_active_card ?? false;
                      const attemptsCount = billing?.attempts_count ?? 0;
                      const lastAttemptAt = billing?.last_attempt_at;
                      const lastAttemptStatus = billing?.last_attempt_status;
                      const notified = billing?.notified;
                      
                      // TG notification status: tomorrow_charge_at indicates notification sent
                      const tgSent = !!notified?.tomorrow_charge_at || !!notified?.no_card_at || !!notified?.failed_at;
                      // Email would be similar if we track it
                      const emailSent = false; // Placeholder until email tracking is added
                      
                      return (
                        <TableRow
                          key={prereg.id}
                          className={`cursor-pointer hover:bg-muted/50 transition-colors ${isSelected ? "bg-primary/10" : ""}`}
                          onClick={() => openDetail(prereg)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelection(prereg.id, true)}
                            />
                          </TableCell>
                          <TableCell>
                            {prereg.user_id ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/admin/contacts?contact=${prereg.user_id}&from=preregistrations`);
                                }}
                                className="font-medium text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                              >
                                {prereg.name}
                              </button>
                            ) : (
                              <span className="font-medium">{prereg.name}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>{prereg.email}</div>
                              {prereg.phone && (
                                <div className="text-muted-foreground">{prereg.phone}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">
                              {getProductName(prereg.product_code)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </TableCell>
                          {/* PATCH-3: Card column */}
                          <TableCell className="text-center">
                            {hasCard ? (
                              <CreditCard className="h-4 w-4 text-green-500 mx-auto" />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          {/* PATCH-3: Attempts column */}
                          <TableCell className="text-center">
                            <span className="text-sm">{attemptsCount}/3</span>
                          </TableCell>
                          {/* PATCH-3: Last Attempt column */}
                          <TableCell>
                            {lastAttemptAt ? (
                              <div className="text-xs">
                                <div>{format(new Date(lastAttemptAt), "dd.MM HH:mm", { locale: ru })}</div>
                                <div className={lastAttemptStatus === 'success' ? 'text-green-500' : lastAttemptStatus === 'failed' ? 'text-red-500' : 'text-muted-foreground'}>
                                  {lastAttemptStatus === 'success' ? 'ok' : lastAttemptStatus === 'failed' ? 'fail' : lastAttemptStatus || '—'}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          {/* PATCH-3: TG notification column */}
                          <TableCell className="text-center">
                            <span className={`text-lg ${tgSent ? 'text-green-500' : 'text-muted-foreground'}`}>
                              {tgSent ? '●' : '○'}
                            </span>
                          </TableCell>
                          {/* PATCH-3: Email notification column */}
                          <TableCell className="text-center">
                            <span className={`text-lg ${emailSent ? 'text-green-500' : 'text-muted-foreground'}`}>
                              {emailSent ? '●' : '○'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {format(new Date(prereg.created_at), "dd.MM.yy", { locale: ru })}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        Предзаписи не найдены
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedIds.size}
        onClearSelection={clearSelection}
        onBulkDelete={handleBulkDelete}
        onSelectAll={selectAll}
        totalCount={preregistrations?.length || 0}
        entityName="предзаписей"
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить предзаписи?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы собираетесь удалить {selectedIds.size} предзаписей. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PreregistrationDetailSheet
        preregistration={selectedPreregistration}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
      />
    </>
  );
}
