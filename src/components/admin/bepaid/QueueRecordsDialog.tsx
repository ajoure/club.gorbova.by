import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  RefreshCw, Package, Mail, CreditCard, Calendar, Info
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { DateFilter } from "@/hooks/useBepaidData";

interface QueueRecordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  dateFilter?: DateFilter;
}

export default function QueueRecordsDialog({ 
  open, 
  onOpenChange, 
  productName,
  dateFilter
}: QueueRecordsDialogProps) {
  // Fetch queue records for this product name
  const { data: records, isLoading, refetch } = useQuery({
    queryKey: ["queue-records-by-product", productName, dateFilter],
    queryFn: async () => {
      const fromDate = dateFilter?.from || "2026-01-01";
      
      let query = supabase
        .from("payment_reconcile_queue")
        .select("*")
        .gte("created_at", `${fromDate}T00:00:00Z`)
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (dateFilter?.to) {
        query = query.lte("created_at", `${dateFilter.to}T23:59:59Z`);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter by product name in raw_payload
      return (data || []).filter(record => {
        const payload = record.raw_payload as Record<string, any> | null;
        if (!payload) return false;
        const plan = payload.plan || {};
        const additionalData = payload.additional_data || {};
        const name = plan.title || plan.name || additionalData.description;
        return name === productName;
      }).map(record => {
        const payload = record.raw_payload as Record<string, any> | null;
        const card = payload?.card || {};
        const plan = payload?.plan || {};
        const additionalData = payload?.additional_data || {};
        
        return {
          id: record.id,
          created_at: record.created_at,
          amount: record.amount ? record.amount / 100 : (plan.amount ? plan.amount / 100 : null),
          currency: record.currency || plan.currency || "BYN",
          customer_email: record.customer_email,
          card_holder: card.holder || null,
          card_last4: card.last_4 || null,
          description: additionalData.description || null,
          tariff_code: additionalData.tariff_code || null,
          tracking_id: record.tracking_id,
          order_id: additionalData.order_id || null,
          status: record.status,
        };
      });
    },
    enabled: open && !!productName,
  });

  // Get unique amounts and descriptions
  const uniqueAmounts = [...new Set(records?.map(r => r.amount).filter(Boolean))].sort((a, b) => (a || 0) - (b || 0));
  const uniqueDescriptions = [...new Set(records?.map(r => r.description).filter(Boolean))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Записи очереди: {productName}
          </DialogTitle>
          <DialogDescription>
            Реальные записи из очереди bePaid для сверки маппинга
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div className="flex flex-wrap gap-2 py-2 border-b">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Найдено:</span>
            <Badge variant="secondary">{records?.length || 0} записей</Badge>
          </div>
          {uniqueAmounts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Суммы:</span>
              {uniqueAmounts.map(amount => (
                <Badge key={amount} variant="outline">{amount} BYN</Badge>
              ))}
            </div>
          )}
        </div>

        {/* Descriptions */}
        {uniqueDescriptions.length > 0 && (
          <div className="flex flex-wrap gap-2 py-2 border-b">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Описания:
            </span>
            <span className="text-sm">{uniqueDescriptions.slice(0, 5).join("; ")}</span>
          </div>
        )}

        <div className="mt-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : records && records.length > 0 ? (
            <ScrollArea className="max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Владелец карты</TableHead>
                    <TableHead>Описание</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(record.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {record.amount} {record.currency}
                      </TableCell>
                      <TableCell>
                        {record.customer_email ? (
                          <div className="flex items-center gap-1 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span className="truncate max-w-[150px]">{record.customer_email}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.card_holder ? (
                          <div className="flex items-center gap-1 text-sm">
                            <CreditCard className="h-3 w-3 text-muted-foreground" />
                            <span>{record.card_holder}</span>
                            {record.card_last4 && (
                              <Badge variant="outline" className="text-xs">*{record.card_last4}</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm truncate max-w-[150px] block">
                          {record.description || record.tariff_code || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={record.status === "pending" ? "outline" : "secondary"}>
                          {record.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Нет записей для этого продукта</p>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center mt-4 pt-4 border-t">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
