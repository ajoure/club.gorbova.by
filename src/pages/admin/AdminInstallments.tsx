import { useState } from "react";
import { format, isPast } from "date-fns";
import { ru } from "date-fns/locale";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "lucide-react";
import {
  useAdminInstallments,
  useChargeInstallment,
  type InstallmentWithDetails,
} from "@/hooks/useInstallments";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  succeeded: { label: "Оплачен", variant: "default" },
  pending: { label: "Ожидает", variant: "secondary" },
  processing: { label: "Обработка", variant: "outline" },
  failed: { label: "Ошибка", variant: "destructive" },
  cancelled: { label: "Отменён", variant: "outline" },
};

export default function AdminInstallments() {
  const [activeTab, setActiveTab] = useState("pending");
  const { data: installments, isLoading } = useAdminInstallments(activeTab);
  const chargeInstallment = useChargeInstallment();

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  };

  const isOverdue = (installment: InstallmentWithDetails) => {
    return installment.status === "pending" && isPast(new Date(installment.due_date));
  };

  // Calculate stats
  const stats = {
    pending: installments?.filter(i => i.status === "pending").length || 0,
    overdue: installments?.filter(i => isOverdue(i)).length || 0,
    totalPending: installments
      ?.filter(i => i.status === "pending")
      .reduce((sum, i) => sum + Number(i.amount), 0) || 0,
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Рассрочки</h1>
          <p className="text-muted-foreground">Управление графиками платежей</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Ожидают оплаты
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card className={stats.overdue > 0 ? "border-destructive/50" : ""}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Просрочено
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stats.overdue > 0 ? "text-destructive" : ""}`}>
                {stats.overdue}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Ожидаемые поступления
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatAmount(stats.totalPending)} BYN
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              График платежей
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="pending">Ожидают</TabsTrigger>
                <TabsTrigger value="overdue">
                  Просрочены
                  {stats.overdue > 0 && (
                    <Badge variant="destructive" className="ml-2 h-5 px-1.5">
                      {stats.overdue}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="succeeded">Оплачены</TabsTrigger>
                <TabsTrigger value="all">Все</TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} className="mt-4">
                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : installments && installments.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Клиент</TableHead>
                          <TableHead>Продукт</TableHead>
                          <TableHead>Платёж</TableHead>
                          <TableHead>Сумма</TableHead>
                          <TableHead>Дата</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead className="w-[100px]">Действия</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {installments.map((installment) => {
                          const overdue = isOverdue(installment);
                          const config = statusConfig[installment.status] || statusConfig.pending;

                          return (
                            <TableRow
                              key={installment.id}
                              className={overdue ? "bg-destructive/5" : ""}
                            >
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Users className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <p className="font-medium">
                                      {installment.profiles?.full_name || "—"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {installment.profiles?.email}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium">
                                    {installment.subscriptions_v2?.products_v2?.name || "—"}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {installment.subscriptions_v2?.tariffs?.name}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {installment.payment_number}/{installment.total_payments}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-medium">
                                {formatAmount(Number(installment.amount))} {installment.currency}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {overdue && (
                                    <AlertTriangle className="h-4 w-4 text-destructive" />
                                  )}
                                  <span className={overdue ? "text-destructive" : ""}>
                                    {format(new Date(installment.due_date), "d MMM yyyy", { locale: ru })}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={config.variant}>
                                  {config.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {installment.status === "pending" && (
                                  <Button
                                    size="sm"
                                    onClick={() => chargeInstallment.mutate(installment.id)}
                                    disabled={chargeInstallment.isPending}
                                    className="gap-1"
                                  >
                                    {chargeInstallment.isPending ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Zap className="h-3 w-3" />
                                    )}
                                    Списать
                                  </Button>
                                )}
                                {installment.status === "succeeded" && (
                                  <Check className="h-4 w-4 text-green-600" />
                                )}
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
                    <p>Нет платежей в этой категории</p>
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
