import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AlertTriangle, Search, Download, RefreshCw, AlertCircle, HelpCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface DiagnosticItem {
  order_id: string;
  order_number: string;
  created_at: string;
  profile_id: string | null;
  full_name: string | null;
  email: string | null;
  bepaid_uid: string | null;
  linked_payments_count: number;
  diagnosis: 'MISMATCH_DUPLICATE_ORDER' | 'MISSING_PAYMENT_RECORD' | 'NO_BEPAID_UID';
  diagnosis_detail: string;
  existing_payment_id?: string;
  payment_linked_to_order_id?: string;
  payment_linked_to_order_number?: string;
}

interface DiagnosticSummary {
  total_paid_orders: number;
  orders_with_payments: number;
  mismatch_duplicate: number;
  missing_payment: number;
  no_bepaid_uid: number;
}

const DIAGNOSIS_CONFIG = {
  MISMATCH_DUPLICATE_ORDER: {
    label: "Дубликат",
    variant: "destructive" as const,
    icon: XCircle,
    color: "text-red-500",
  },
  MISSING_PAYMENT_RECORD: {
    label: "Нет записи",
    variant: "secondary" as const,
    icon: AlertCircle,
    color: "text-amber-500",
  },
  NO_BEPAID_UID: {
    label: "Нет UID",
    variant: "outline" as const,
    icon: HelpCircle,
    color: "text-muted-foreground",
  },
};

interface PaymentDiagnosticsDialogProps {
  onComplete?: () => void;
}

export default function PaymentDiagnosticsDialog({ onComplete }: PaymentDiagnosticsDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);
  const [items, setItems] = useState<DiagnosticItem[]>([]);

  const runDiagnostics = async () => {
    setLoading(true);
    setSummary(null);
    setItems([]);
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-payments-diagnostics');
      
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Diagnostics failed');
      
      setSummary(data.summary);
      setItems(data.items || []);
      
      if (data.items?.length === 0) {
        toast.success("Проблемных заказов не найдено!");
      } else {
        toast.warning(`Найдено ${data.items.length} проблемных заказов`);
      }
    } catch (err: any) {
      console.error("Diagnostics error:", err);
      toast.error("Ошибка диагностики: " + (err.message || "Неизвестная ошибка"));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (items.length === 0) return;
    
    const csv = [
      ["Order ID", "Order Number", "Created", "Profile", "Email", "bePaid UID", "Diagnosis", "Detail", "Payment ID", "Linked Order"].join(";"),
      ...items.map(item => [
        item.order_id,
        item.order_number,
        item.created_at ? format(new Date(item.created_at), "dd.MM.yyyy HH:mm") : "",
        item.full_name || "",
        item.email || "",
        item.bepaid_uid || "",
        item.diagnosis,
        item.diagnosis_detail.replace(/;/g, ","),
        item.existing_payment_id || "",
        item.payment_linked_to_order_number || "",
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-diagnostics-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV экспортирован");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <AlertTriangle className="h-4 w-4" />
          Диагностика потерь
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Диагностика потери платежей
          </DialogTitle>
          <DialogDescription>
            Поиск заказов со статусом "оплачен", у которых отсутствует запись платежа в payments_v2
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button onClick={runDiagnostics} disabled={loading} className="gap-2">
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loading ? "Анализ..." : "Запустить диагностику"}
            </Button>
            
            {items.length > 0 && (
              <Button variant="outline" onClick={handleExport} className="gap-2">
                <Download className="h-4 w-4" />
                Экспорт CSV
              </Button>
            )}
          </div>

          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold">{summary.total_paid_orders}</div>
                  <div className="text-xs text-muted-foreground">Всего paid</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{summary.orders_with_payments}</div>
                  <div className="text-xs text-muted-foreground">С платежами</div>
                </CardContent>
              </Card>
              <Card className="border-red-200 bg-red-50/50">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-red-600">{summary.mismatch_duplicate}</div>
                  <div className="text-xs text-muted-foreground">Дубликаты</div>
                </CardContent>
              </Card>
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-amber-600">{summary.missing_payment}</div>
                  <div className="text-xs text-muted-foreground">Нет записи</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-muted-foreground">{summary.no_bepaid_uid}</div>
                  <div className="text-xs text-muted-foreground">Нет UID</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {/* Results table */}
          {!loading && items.length > 0 && (
            <ScrollArea className="h-[400px] border rounded-lg">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Заказ</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead>Контакт</TableHead>
                    <TableHead>bePaid UID</TableHead>
                    <TableHead>Диагноз</TableHead>
                    <TableHead>Связанный заказ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const config = DIAGNOSIS_CONFIG[item.diagnosis];
                    const Icon = config.icon;
                    
                    return (
                      <TableRow key={item.order_id}>
                        <TableCell className="font-mono text-sm">
                          {item.order_number}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.created_at 
                            ? format(new Date(item.created_at), "dd.MM.yy HH:mm", { locale: ru })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {item.full_name || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.email || "—"}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[120px] truncate">
                          {item.bepaid_uid || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Icon className={`h-4 w-4 ${config.color}`} />
                            <Badge variant={config.variant} className="text-xs">
                              {config.label}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 max-w-[200px]" title={item.diagnosis_detail}>
                            {item.diagnosis_detail.length > 60 
                              ? item.diagnosis_detail.substring(0, 60) + "..." 
                              : item.diagnosis_detail}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.diagnosis === 'MISMATCH_DUPLICATE_ORDER' && item.payment_linked_to_order_number && (
                            <div className="text-sm">
                              <span className="font-mono">{item.payment_linked_to_order_number}</span>
                              <div className="text-xs text-muted-foreground">
                                Payment: {item.existing_payment_id?.substring(0, 8)}...
                              </div>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}

          {/* Empty state */}
          {!loading && summary && items.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <div className="text-4xl mb-2">✅</div>
              <div>Проблемных заказов не найдено</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
