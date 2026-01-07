import { useState } from "react";
import { format, isPast, startOfDay, endOfDay, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  cancelled: { label: "Отменён", variant: "outline", color: "text-muted-foreground" },
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

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-6 w-6" />
              Рассрочки
            </h1>
            <p className="text-muted-foreground">Управление графиками платежей</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </Button>
            <Button
              size="sm"
              onClick={() => runCronMutation.mutate()}
              disabled={runCronMutation.isPending}
              className="gap-1.5"
            >
              {runCronMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Списать все просроченные
            </Button>
          </div>
        </div>

        {/* Stats */}
        {installments && <InstallmentStats installments={installments} />}

        {/* Main content */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                График платежей
              </CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по имени, email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="pending" className="gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Ожидают
                  {stats.pending > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                      {stats.pending}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="overdue" className="gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Просрочены
                  {stats.overdue > 0 && (
                    <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                      {stats.overdue}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="succeeded" className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Оплачены
                </TabsTrigger>
                <TabsTrigger value="all">Все</TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} className="mt-0">
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
                                    <p className="font-medium line-clamp-1">
                                      {installment.profiles?.full_name || "—"}
                                    </p>
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
                                  className={cn("gap-1", config.color)}
                                >
                                  {installment.status === "succeeded" && <Check className="h-3 w-3" />}
                                  {installment.status === "pending" && <Clock className="h-3 w-3" />}
                                  {installment.status === "failed" && <AlertTriangle className="h-3 w-3" />}
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
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
