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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AlertTriangle, Search, Download, RefreshCw, AlertCircle, HelpCircle, XCircle, Play, Undo2, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface DiagnosticItem {
  id: string;
  entity_type: 'order' | 'payment' | 'queue';
  entity_id: string;
  order_id: string | null;
  order_number: string | null;
  created_at: string;
  profile_id: string | null;
  full_name: string | null;
  email: string | null;
  bepaid_uid: string | null;
  amount: number | null;
  diagnosis: 'MISMATCH_DUPLICATE_ORDER' | 'MISSING_PAYMENT_RECORD' | 'NO_BEPAID_UID' | 'ORDER_DUPLICATE' | 'PAYMENT_WITHOUT_ORDER' | 'REFUND_NOT_LINKED';
  diagnosis_detail: string;
  can_auto_fix: boolean;
  fix_action?: string;
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
  order_duplicate: number;
  payment_without_order: number;
  refund_not_linked: number;
  can_auto_fix: number;
}

const DIAGNOSIS_CONFIG: Record<string, { label: string; variant: "destructive" | "secondary" | "outline" | "default"; icon: any; color: string }> = {
  MISMATCH_DUPLICATE_ORDER: { label: "Дубликат", variant: "destructive", icon: XCircle, color: "text-red-500" },
  ORDER_DUPLICATE: { label: "Дубликат", variant: "destructive", icon: XCircle, color: "text-red-500" },
  MISSING_PAYMENT_RECORD: { label: "Нет записи", variant: "secondary", icon: AlertCircle, color: "text-amber-500" },
  NO_BEPAID_UID: { label: "Нет UID", variant: "outline", icon: HelpCircle, color: "text-muted-foreground" },
  PAYMENT_WITHOUT_ORDER: { label: "Сирота", variant: "secondary", icon: CreditCard, color: "text-blue-500" },
  REFUND_NOT_LINKED: { label: "Возврат", variant: "default", icon: Undo2, color: "text-purple-500" },
};

interface PaymentDiagnosticsDialogProps {
  onComplete?: () => void;
  renderTrigger?: (onClick: () => void) => React.ReactNode;
}

export default function PaymentDiagnosticsDialog({ onComplete, renderTrigger }: PaymentDiagnosticsDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const runDiagnostics = async (mode: 'diagnose' | 'dry-run' = 'diagnose') => {
    setLoading(true);
    setSummary(null);
    setItems([]);
    setSelectedIds(new Set());
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-payments-diagnostics', {
        body: { mode }
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Diagnostics failed');
      
      setSummary(data.summary);
      setItems(data.items || []);
      
      // Auto-select fixable items
      const fixable = (data.items || []).filter((i: DiagnosticItem) => i.can_auto_fix).map((i: DiagnosticItem) => i.id);
      setSelectedIds(new Set(fixable));
      
      if (data.items?.length === 0) {
        toast.success("Проблемных записей не найдено!");
      } else {
        toast.warning(`Найдено ${data.items.length} проблем, ${fixable.length} можно исправить`);
      }
    } catch (err: any) {
      console.error("Diagnostics error:", err);
      toast.error("Ошибка диагностики: " + (err.message || "Неизвестная ошибка"));
    } finally {
      setLoading(false);
    }
  };

  const executeFixs = async () => {
    if (selectedIds.size === 0) {
      toast.error("Выберите элементы для исправления");
      return;
    }
    
    setExecuting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-payments-diagnostics', {
        body: { mode: 'execute', itemIds: Array.from(selectedIds), maxItems: 50 }
      });
      
      if (error) throw error;
      
      const successCount = data?.summary?.success || 0;
      const failCount = data?.summary?.failed || 0;
      
      if (successCount > 0) {
        toast.success(`Исправлено: ${successCount}, ошибок: ${failCount}`);
        onComplete?.();
        // Re-run diagnostics to refresh
        await runDiagnostics();
      } else {
        toast.error(`Не удалось исправить. Ошибок: ${failCount}`);
      }
    } catch (err: any) {
      toast.error("Ошибка: " + (err.message || "Неизвестная ошибка"));
    } finally {
      setExecuting(false);
    }
  };

  const handleExport = () => {
    if (items.length === 0) return;
    
    const csv = [
      ["ID", "Type", "Order", "Created", "Email", "bePaid UID", "Amount", "Diagnosis", "Can Fix"].join(";"),
      ...items.map(item => [
        item.id,
        item.entity_type,
        item.order_number || "",
        item.created_at ? format(new Date(item.created_at), "dd.MM.yyyy HH:mm") : "",
        item.email || "",
        item.bepaid_uid || "",
        item.amount || "",
        item.diagnosis,
        item.can_auto_fix ? "Yes" : "No",
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-diagnostics-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const fixableItems = items.filter(i => i.can_auto_fix);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {renderTrigger ? (
        <span onClick={() => setOpen(true)}>{renderTrigger(() => setOpen(true))}</span>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Диагностика потерь
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Диагностика платежей v2
          </DialogTitle>
          <DialogDescription>
            Поиск проблем: дубликаты, потерянные платежи, неprivязанные возвраты
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => runDiagnostics('diagnose')} disabled={loading || executing} className="gap-2">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loading ? "Анализ..." : "Диагностика"}
            </Button>
            
            {fixableItems.length > 0 && (
              <Button 
                onClick={executeFixs} 
                disabled={executing || selectedIds.size === 0}
                variant="default"
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                {executing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Исправить ({selectedIds.size})
              </Button>
            )}
            
            {items.length > 0 && (
              <Button variant="outline" onClick={handleExport} className="gap-2">
                <Download className="h-4 w-4" />
                CSV
              </Button>
            )}
          </div>

          {summary && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center text-sm">
              <Card><CardContent className="p-2"><div className="font-bold">{summary.total_paid_orders}</div><div className="text-xs text-muted-foreground">Paid</div></CardContent></Card>
              <Card className="border-green-200"><CardContent className="p-2"><div className="font-bold text-green-600">{summary.orders_with_payments}</div><div className="text-xs">OK</div></CardContent></Card>
              <Card className="border-red-200"><CardContent className="p-2"><div className="font-bold text-red-600">{(summary.mismatch_duplicate || 0) + (summary.order_duplicate || 0)}</div><div className="text-xs">Дубли</div></CardContent></Card>
              <Card className="border-amber-200"><CardContent className="p-2"><div className="font-bold text-amber-600">{summary.missing_payment}</div><div className="text-xs">Нет записи</div></CardContent></Card>
              <Card className="border-purple-200"><CardContent className="p-2"><div className="font-bold text-purple-600">{summary.refund_not_linked || 0}</div><div className="text-xs">Возвраты</div></CardContent></Card>
              <Card className="border-blue-200"><CardContent className="p-2"><div className="font-bold text-blue-600">{summary.can_auto_fix}</div><div className="text-xs">Авто-fix</div></CardContent></Card>
            </div>
          )}

          {loading && <Skeleton className="h-32 w-full" />}

          {!loading && items.length > 0 && (
            <ScrollArea className="h-[350px] border rounded-lg">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Заказ</TableHead>
                    <TableHead>Контакт</TableHead>
                    <TableHead>UID</TableHead>
                    <TableHead>Диагноз</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const config = DIAGNOSIS_CONFIG[item.diagnosis] || DIAGNOSIS_CONFIG.NO_BEPAID_UID;
                    const Icon = config.icon;
                    
                    return (
                      <TableRow key={item.id} className={selectedIds.has(item.id) ? "bg-muted/50" : ""}>
                        <TableCell>
                          {item.can_auto_fix && (
                            <Checkbox 
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={() => toggleSelect(item.id)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-sm">{item.order_number || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.created_at ? format(new Date(item.created_at), "dd.MM.yy", { locale: ru }) : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm truncate max-w-[120px]">{item.full_name || item.email || "—"}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[100px] truncate">
                          {item.bepaid_uid?.substring(0, 12) || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Icon className={`h-3 w-3 ${config.color}`} />
                            <Badge variant={config.variant} className="text-xs">{config.label}</Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}

          {!loading && summary && items.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">✅ Проблем не найдено</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
