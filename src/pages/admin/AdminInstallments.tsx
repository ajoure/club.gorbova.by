import { useState } from "react";
import { format, isPast, startOfDay, endOfDay, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
// Tabs removed - using pill-style tabs
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Calendar,
  CreditCard,
  AlertTriangle,
  Check,
  Clock,
  Zap,
  Loader2,
  Users,
  TrendingUp,
  Search,
  MoreHorizontal,
  Bell,
  RefreshCw,
  Eye,
  Mail,
  ChevronRight,
  Filter,
  XCircle,
  Gift,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useAdminInstallments,
  useChargeInstallment,
  type InstallmentWithDetails,
} from "@/hooks/useInstallments";
import { InstallmentStats } from "@/components/installments/InstallmentStats";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { 
  label: string; 
  variant: "default" | "secondary" | "destructive" | "outline";
  color: string;
}> = {
  succeeded: { label: "Оплачен", variant: "default", color: "text-green-600" },
  pending: { label: "Ожидает", variant: "secondary", color: "text-amber-600" },
  processing: { label: "Обработка", variant: "outline", color: "text-blue-600" },
  failed: { label: "Ошибка", variant: "destructive", color: "text-red-600" },
  cancelled: { label: "Не оплачено", variant: "outline", color: "text-muted-foreground" },
  forgiven: { label: "Прощено", variant: "outline", color: "text-purple-600" },
};

export default function AdminInstallments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const { data: installments, isLoading, refetch } = useAdminInstallments(activeTab);
  const chargeInstallment = useChargeInstallment();

  // Send reminder mutation
  const sendReminderMutation = useMutation({
    mutationFn: async (installmentId: string) => {
      const { data, error } = await supabase.functions.invoke("installment-notifications", {
        body: { action: "upcoming", installment_id: installmentId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Напоминание отправлено");
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Run cron job manually
  const runCronMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("installment-charge-cron");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const results = data.results;
      if (results) {
        toast.success(
          `Обработано: ${results.processed}, успешно: ${results.successful}, ошибок: ${results.failed}`
        );
      } else {
        toast.success("Задача выполнена");
      }
      queryClient.invalidateQueries({ queryKey: ["admin-installments"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const isOverdue = (installment: InstallmentWithDetails) => {
    return installment.status === "pending" && isPast(new Date(installment.due_date));
  };

  // Filter by search query
  const filteredInstallments = installments?.filter(i => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    const name = i.profiles?.full_name?.toLowerCase() || "";
    const email = i.profiles?.email?.toLowerCase() || "";
    const product = i.subscriptions_v2?.products_v2?.name?.toLowerCase() || "";
    return name.includes(search) || email.includes(search) || product.includes(search);
  });

  // Calculate stats based on all installments (not filtered by tab)
  const allPending = installments?.filter(i => i.status === "pending") || [];
  const allOverdue = allPending.filter(i => isOverdue(i));

  const stats = {
    pending: allPending.length,
    overdue: allOverdue.length,
    totalPending: allPending.reduce((sum, i) => sum + Number(i.amount), 0),
    dueToday: allPending.filter(i => {
      const dueDate = new Date(i.due_date);
      const today = new Date();
      return dueDate.toDateString() === today.toDateString();
    }).length,
  };

  // Tab definitions for pill-style navigation
  const installmentTabs = [
    { id: "pending", label: "Ожидают", icon: Clock, count: stats.pending },
    { id: "overdue", label: "Просрочены", icon: AlertTriangle, count: stats.overdue, isDestructive: true },
    { id: "succeeded", label: "Оплачены", icon: Check, count: 0 },
    { id: "cancelled", label: "Не оплачено", icon: XCircle, count: 0 },
    { id: "forgiven", label: "Прощено", icon: Gift, count: 0 },
    { id: "all", label: "Все", count: 0 },
  ];

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Pill-style Tabs */}
        <div className="px-1 pt-1 pb-1.5 shrink-0">
          <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none">
            {installmentTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{tab.label}</span>
                  {tab.count > 0 && (
                    <Badge 
                      className={cn(
                        "h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full",
                        tab.isDestructive 
                          ? "bg-destructive/20 text-destructive" 
                          : "bg-primary/20 text-primary"
                      )}
                    >
                      {tab.count > 99 ? "99+" : tab.count}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions row */}
        <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Обновить</span>
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={() => runCronMutation.mutate()}
              disabled={runCronMutation.isPending}
            >
              {runCronMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" />
              ) : (
                <Zap className="h-3.5 w-3.5 sm:mr-1.5" />
              )}
              <span className="hidden sm:inline">Списать просроченные</span>
            </Button>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {/* Stats */}
        {installments && <InstallmentStats installments={installments} />}

        {/* Content */}
        <Card>
          <CardContent className="pt-4">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filteredInstallments && filteredInstallments.length > 0 ? (
              <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Клиент</TableHead>
                          <TableHead>Продукт</TableHead>
                          <TableHead className="text-center">Платёж</TableHead>
                          <TableHead className="text-right">Сумма</TableHead>
                          <TableHead>Дата</TableHead>
                          <TableHead className="text-center">Статус</TableHead>
                          <TableHead className="w-[100px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInstallments.map((installment) => {
                          const overdue = isOverdue(installment);
                          const config = statusConfig[installment.status] || statusConfig.pending;
                          const dueDate = new Date(installment.due_date);
                          const isDueToday = dueDate.toDateString() === new Date().toDateString();

                          return (
                            <TableRow
                              key={installment.id}
                              className={cn(
                                "transition-colors",
                                overdue && "bg-destructive/5 hover:bg-destructive/10",
                                isDueToday && !overdue && "bg-amber-500/5 hover:bg-amber-500/10"
                              )}
                            >
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    <Users className="h-4 w-4 text-primary" />
                                  </div>
                                  <div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/admin/contacts?contact=${installment.user_id}&from=installments`);
                                      }}
                                      className="font-medium line-clamp-1 text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                                    >
                                      {installment.profiles?.full_name || "—"}
                                    </button>
                                    <p className="text-xs text-muted-foreground line-clamp-1">
                                      {installment.profiles?.email}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium line-clamp-1">
                                    {installment.subscriptions_v2?.products_v2?.name || "—"}
                                  </p>
                                  <p className="text-xs text-muted-foreground line-clamp-1">
                                    {installment.subscriptions_v2?.tariffs?.name}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline" className="font-mono">
                                  {installment.payment_number}/{installment.total_payments}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatAmount(Number(installment.amount))} {installment.currency}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  {overdue && (
                                    <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                                  )}
                                  {isDueToday && !overdue && (
                                    <Clock className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                  )}
                                  <span className={cn(
                                    overdue && "text-destructive font-medium",
                                    isDueToday && !overdue && "text-amber-600 font-medium"
                                  )}>
                                    {format(dueDate, "d MMM yyyy", { locale: ru })}
                                  </span>
                                </div>
                                {installment.charge_attempts > 0 && installment.status !== "succeeded" && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Попыток: {installment.charge_attempts}/3
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge 
                                  variant={config.variant}
                                  className={cn(
                                    "gap-1", 
                                    config.color,
                                    installment.status === "forgiven" && "border-purple-500/30 bg-purple-500/10"
                                  )}
                                >
                                  {installment.status === "succeeded" && <Check className="h-3 w-3" />}
                                  {installment.status === "pending" && <Clock className="h-3 w-3" />}
                                  {installment.status === "failed" && <AlertTriangle className="h-3 w-3" />}
                                  {installment.status === "cancelled" && <XCircle className="h-3 w-3" />}
                                  {installment.status === "forgiven" && <Gift className="h-3 w-3" />}
                                  {config.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-end gap-1">
                                  {installment.status === "pending" && (
                                    <Button
                                      size="sm"
                                      variant={overdue ? "destructive" : "default"}
                                      onClick={() => chargeInstallment.mutate(installment.id)}
                                      disabled={chargeInstallment.isPending}
                                      className="gap-1 h-8"
                                    >
                                      {chargeInstallment.isPending ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Zap className="h-3 w-3" />
                                      )}
                                      <span className="hidden sm:inline">Списать</span>
                                    </Button>
                                  )}
                                  
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => navigate(`/admin/contacts?search=${installment.profiles?.email}`)}
                                      >
                                        <Eye className="h-4 w-4 mr-2" />
                                        Карточка клиента
                                      </DropdownMenuItem>
                                      {installment.status === "pending" && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onClick={() => sendReminderMutation.mutate(installment.id)}
                                            disabled={sendReminderMutation.isPending}
                                          >
                                            <Bell className="h-4 w-4 mr-2" />
                                            Отправить напоминание
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">Нет платежей в этой категории</p>
                    <p className="text-sm">Платежи появятся здесь при оформлении рассрочек</p>
                  </div>
                )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
