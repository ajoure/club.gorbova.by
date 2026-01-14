import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { CreditCard, Mail, Phone, Package, User, FileText, ExternalLink, AlertTriangle, RefreshCw, Copy } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { toast } from "sonner";

interface PaymentsTableProps {
  payments: UnifiedPayment[];
  isLoading: boolean;
  selectedItems: Set<string>;
  onToggleSelectAll: () => void;
  onToggleItem: (id: string) => void;
  onRefetch: () => void;
}

export default function PaymentsTable({ payments, isLoading, selectedItems, onToggleSelectAll, onToggleItem, onRefetch }: PaymentsTableProps) {
  const copyUid = (uid: string) => {
    navigator.clipboard.writeText(uid);
    toast.success("UID скопирован");
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
      successful: { variant: "default", label: "Успешно" },
      succeeded: { variant: "default", label: "Успешно" },
      pending: { variant: "outline", label: "Ожидает" },
      failed: { variant: "destructive", label: "Ошибка" },
      refunded: { variant: "secondary", label: "Возврат" },
    };
    const config = variants[status] || { variant: "outline" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (payments.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">Нет транзакций</div>;
  }

  return (
    <TooltipProvider>
      <div className="overflow-auto max-h-[600px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={selectedItems.size === payments.length && payments.length > 0} onCheckedChange={onToggleSelectAll} />
              </TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>UID</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead>Плательщик</TableHead>
              <TableHead>Контакт</TableHead>
              <TableHead>Сделка</TableHead>
              <TableHead>Продукт</TableHead>
              <TableHead>Чек</TableHead>
              <TableHead>Флаги</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id} className={p.has_conflict ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                <TableCell>
                  <Checkbox checked={selectedItems.has(p.id)} onCheckedChange={() => onToggleItem(p.id)} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {p.paid_at ? format(new Date(p.paid_at), "dd.MM.yy HH:mm", { locale: ru }) : "—"}
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-1 font-mono text-xs" onClick={() => copyUid(p.uid)}>
                        {p.uid.substring(0, 8)}...
                        <Copy className="h-3 w-3 ml-1" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{p.uid}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{p.transaction_type || "payment"}</Badge>
                </TableCell>
                <TableCell>{getStatusBadge(p.status_normalized)}</TableCell>
                <TableCell className="text-right font-medium">{p.amount} {p.currency}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5 text-xs">
                    {p.customer_email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{p.customer_email}</div>}
                    {p.card_last4 && <div className="flex items-center gap-1"><CreditCard className="h-3 w-3" />*{p.card_last4} {p.card_brand && <Badge variant="outline" className="text-[10px] px-1">{p.card_brand}</Badge>}</div>}
                    {p.card_holder && <span className="text-muted-foreground">{p.card_holder}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {p.profile_id ? (
                    <div className="flex items-center gap-1 text-xs">
                      <User className="h-3 w-3 text-green-500" />
                      <span className="font-medium">{p.profile_name || "Связан"}</span>
                      {p.is_ghost && <Badge variant="outline" className="text-[10px]">Ghost</Badge>}
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-xs">Не связан</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {p.order_id ? (
                    <div className="text-xs">
                      <span className="font-medium">{p.order_number || "Связан"}</span>
                      {p.order_status && <Badge variant="outline" className="ml-1 text-[10px]">{p.order_status}</Badge>}
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-xs">Нет</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="text-xs max-w-[120px] truncate">
                    {p.product_name || p.bepaid_product || "—"}
                  </div>
                </TableCell>
                <TableCell>
                  {p.receipt_url ? (
                    <Button variant="ghost" size="sm" className="h-6 px-1" asChild>
                      <a href={p.receipt_url} target="_blank" rel="noopener noreferrer">
                        <FileText className="h-3 w-3" />
                      </a>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {p.is_external && <Badge variant="secondary" className="text-[10px]">Внешний</Badge>}
                    {p.has_conflict && <Badge variant="destructive" className="text-[10px]">Конфликт</Badge>}
                    {p.refunds_count > 0 && <Badge variant="outline" className="text-[10px]">Возвр: {p.refunds_count}</Badge>}
                    {p.source === 'queue' && <Badge variant="outline" className="text-[10px]">Очередь</Badge>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
