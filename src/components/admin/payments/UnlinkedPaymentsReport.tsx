import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, CreditCard, AlertTriangle, Link2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import UnlinkedPaymentsDetailDrawer from "./UnlinkedPaymentsDetailDrawer";
import AdminAutolinkDialog from "./AdminAutolinkDialog";

interface UnlinkedCardAggregation {
  last4: string;
  brand: string;
  unlinked_payments_v2_count: number;
  unlinked_queue_count: number;
  payments_amount: number;
  queue_amount: number;
  total_amount: number;
  last_seen_at: string | null;
  collision_risk: boolean;
}

interface UnlinkedPaymentsReportProps {
  onComplete: () => void;
}

const BRAND_LABELS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  belkart: 'Belkart',
  maestro: 'Maestro',
  mir: 'МИР',
};

export default function UnlinkedPaymentsReport({ onComplete }: UnlinkedPaymentsReportProps) {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<UnlinkedCardAggregation[]>([]);
  const [totalPayments, setTotalPayments] = useState(0);
  const [totalQueue, setTotalQueue] = useState(0);

  // Detail drawer state
  const [selectedCard, setSelectedCard] = useState<{ last4: string; brand: string; collisionRisk: boolean } | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-unlinked-payments-report', {
        body: { mode: 'aggregates' }
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to fetch report');

      setCards(data.cards || []);
      setTotalPayments(data.total_unlinked_payments || 0);
      setTotalQueue(data.total_unlinked_queue || 0);
    } catch (err: unknown) {
      console.error('Error fetching unlinked report:', err);
      const message = err instanceof Error ? err.message : 'Ошибка загрузки отчёта';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleRefresh = () => {
    fetchReport();
  };

  const handleAutolinked = () => {
    fetchReport();
    onComplete();
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const totalUnlinked = totalPayments + totalQueue;
  const totalAmount = cards.reduce((sum, c) => sum + c.total_amount, 0);
  const collisionCount = cards.filter(c => c.collision_risk).length;

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Непривязанные платежи
              </CardTitle>
              <CardDescription>
                Транзакции без связи с контактом (profile_id IS NULL)
              </CardDescription>
            </div>
            <Button variant="outline" onClick={handleRefresh} disabled={loading} className="gap-2">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Обновить
            </Button>
          </div>

          {/* Summary badges */}
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="outline" className="text-sm py-1 px-3">
              Всего: {totalUnlinked} транзакций
            </Badge>
            <Badge variant="secondary" className="text-sm py-1 px-3">
              payments_v2: {totalPayments}
            </Badge>
            <Badge variant="secondary" className="text-sm py-1 px-3">
              queue: {totalQueue}
            </Badge>
            <Badge variant="outline" className="text-sm py-1 px-3">
              {formatAmount(totalAmount)} BYN
            </Badge>
            {collisionCount > 0 && (
              <Badge variant="destructive" className="text-sm py-1 px-3 gap-1">
                <AlertTriangle className="h-3 w-3" />
                {collisionCount} с коллизией
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : cards.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">
                Все платежи привязаны
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Нет транзакций без связи с контактом
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Карта</TableHead>
                    <TableHead>Бренд</TableHead>
                    <TableHead className="text-center">payments_v2</TableHead>
                    <TableHead className="text-center">queue</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead>Последний</TableHead>
                    <TableHead className="text-center">Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cards.map((card) => (
                    <TableRow 
                      key={`${card.last4}-${card.brand}`}
                      className={cn(card.collision_risk && "bg-yellow-50/50 dark:bg-yellow-950/10")}
                    >
                      <TableCell className="font-mono font-medium">
                        *{card.last4}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {BRAND_LABELS[card.brand] || card.brand}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {card.unlinked_payments_v2_count > 0 ? (
                          <Badge variant="secondary">{card.unlinked_payments_v2_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {card.unlinked_queue_count > 0 ? (
                          <Badge variant="secondary">{card.unlinked_queue_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatAmount(card.total_amount)} BYN
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {card.last_seen_at
                          ? format(new Date(card.last_seen_at), 'dd.MM.yyyy')
                          : '—'
                        }
                      </TableCell>
                      <TableCell className="text-center">
                        {card.collision_risk ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Коллизия
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-600">
                            OK
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedCard({
                              last4: card.last4,
                              brand: card.brand,
                              collisionRisk: card.collision_risk,
                            })}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          
                          {!card.collision_risk && (
                            <AdminAutolinkDialog
                              onComplete={handleAutolinked}
                              prefillLast4={card.last4}
                              prefillBrand={card.brand}
                              renderTrigger={(onClick) => (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={onClick}
                                >
                                  <Link2 className="h-4 w-4" />
                                </Button>
                              )}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail drawer */}
      {selectedCard && (
        <UnlinkedPaymentsDetailDrawer
          open={!!selectedCard}
          onOpenChange={(open) => !open && setSelectedCard(null)}
          last4={selectedCard.last4}
          brand={selectedCard.brand}
          collisionRisk={selectedCard.collisionRisk}
          onComplete={handleAutolinked}
        />
      )}
    </>
  );
}
