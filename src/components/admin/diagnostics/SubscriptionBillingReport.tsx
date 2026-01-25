import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBillingReport, type BillingReportItem } from "@/hooks/useBillingReport";
import { BillingDetailSheet } from "./BillingDetailSheet";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import {
  CalendarClock,
  CreditCard,
  CheckCircle,
  XCircle,
  AlertCircle,
  Bell,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SubscriptionBillingReportProps {
  className?: string;
}

export function SubscriptionBillingReport({ className }: SubscriptionBillingReportProps) {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<BillingReportItem | null>(null);
  const [showSheet, setShowSheet] = useState(false);

  const { summary, details, isLoading, refetch } = useBillingReport(selectedDate);

  const handlePrevDay = () => {
    const date = parseISO(selectedDate);
    date.setDate(date.getDate() - 1);
    setSelectedDate(format(date, "yyyy-MM-dd"));
  };

  const handleNextDay = () => {
    const date = parseISO(selectedDate);
    date.setDate(date.getDate() + 1);
    setSelectedDate(format(date, "yyyy-MM-dd"));
  };

  const handleToday = () => {
    setSelectedDate(format(new Date(), "yyyy-MM-dd"));
  };

  const isToday = selectedDate === format(new Date(), "yyyy-MM-dd");

  // Filter details by search
  const filteredDetails = details.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.full_name?.toLowerCase().includes(q) ||
      item.email?.toLowerCase().includes(q) ||
      item.phone?.includes(q) ||
      item.product_name?.toLowerCase().includes(q)
    );
  });

  const handleRowClick = (item: BillingReportItem) => {
    setSelectedItem(item);
    setShowSheet(true);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header with date selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">
            Отчёт за {format(parseISO(selectedDate), "d MMMM yyyy", { locale: ru })}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handlePrevDay}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant={isToday ? "secondary" : "outline"}
            size="sm"
            onClick={handleToday}
          >
            Сегодня
          </Button>
          <Button variant="outline" size="icon" onClick={handleNextDay} disabled={isToday}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <SummaryCard
          label="Попыток"
          value={summary.chargeAttempts}
          icon={CreditCard}
          isLoading={isLoading}
        />
        <SummaryCard
          label="Успешно"
          value={summary.successCount}
          icon={CheckCircle}
          variant="success"
          isLoading={isLoading}
        />
        <SummaryCard
          label="Ошибок"
          value={summary.failedCount}
          icon={XCircle}
          variant="destructive"
          isLoading={isLoading}
        />
        <SummaryCard
          label="Нет карты"
          value={summary.noCardCount}
          icon={AlertCircle}
          variant="warning"
          isLoading={isLoading}
        />
        <SummaryCard
          label="7 дней"
          value={summary.reminders7d}
          icon={Bell}
          isLoading={isLoading}
        />
        <SummaryCard
          label="3 дня"
          value={summary.reminders3d}
          icon={Bell}
          isLoading={isLoading}
        />
        <SummaryCard
          label="1 день"
          value={summary.reminders1d}
          icon={Bell}
          isLoading={isLoading}
        />
        <SummaryCard
          label="Предупр."
          value={summary.noCardWarnings}
          icon={AlertCircle}
          variant="warning"
          isLoading={isLoading}
        />
      </div>

      {/* Details Table */}
      <Card>
        <CardHeader className="py-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base">Детали по клиентам</CardTitle>
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredDetails.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {details.length === 0
                ? "Нет попыток списания за выбранную дату"
                : "Ничего не найдено"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Контакт</TableHead>
                  <TableHead className="hidden md:table-cell">Продукт</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead className="text-center">Попыток</TableHead>
                  <TableHead>Результат</TableHead>
                  <TableHead className="hidden lg:table-cell">Уведомления</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDetails.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(item)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {item.full_name || "Без имени"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.email || item.phone}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="truncate max-w-[200px]">
                        {item.product_name || "—"}
                      </div>
                      {item.tariff_name && (
                        <div className="text-xs text-muted-foreground truncate">
                          {item.tariff_name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.amount} {item.currency}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{item.charge_attempts}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.last_charge_error ? (
                        <Badge variant="destructive" className="font-normal">
                          <XCircle className="h-3 w-3 mr-1" />
                          Ошибка
                        </Badge>
                      ) : item.status === "active" ? (
                        <Badge variant="default" className="bg-green-600 font-normal">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Успех
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="font-normal">
                          {item.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex gap-1 flex-wrap">
                        {item.notifications.reminder7d && (
                          <Badge variant="outline" className="text-xs">7д</Badge>
                        )}
                        {item.notifications.reminder3d && (
                          <Badge variant="outline" className="text-xs">3д</Badge>
                        )}
                        {item.notifications.reminder1d && (
                          <Badge variant="outline" className="text-xs">1д</Badge>
                        )}
                        {item.notifications.noCardWarning && (
                          <Badge variant="outline" className="text-xs text-amber-600">⚠️</Badge>
                        )}
                        {!item.notifications.reminder7d &&
                          !item.notifications.reminder3d &&
                          !item.notifications.reminder1d &&
                          !item.notifications.noCardWarning && (
                            <span className="text-muted-foreground">—</span>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <BillingDetailSheet
        open={showSheet}
        onOpenChange={setShowSheet}
        item={selectedItem}
        date={selectedDate}
      />
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  variant?: "default" | "success" | "destructive" | "warning";
  isLoading?: boolean;
}

function SummaryCard({ label, value, icon: Icon, variant = "default", isLoading }: SummaryCardProps) {
  const variantClasses = {
    default: "text-foreground",
    success: "text-green-600",
    destructive: "text-destructive",
    warning: "text-amber-600",
  };

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", variantClasses[variant])} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-8 w-12 mt-1" />
      ) : (
        <div className={cn("text-2xl font-bold mt-1", variantClasses[variant])}>
          {value}
        </div>
      )}
    </Card>
  );
}
