import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CreditCard, Link2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import AdminAutolinkDialog from "./AdminAutolinkDialog";

interface UnlinkedPaymentDetail {
  id: string;
  uid: string | null;
  amount: number;
  paid_at: string | null;
  status: string | null;
  source: 'payments_v2' | 'queue';
  customer_email?: string | null;
  card_holder?: string | null;
}

interface UnlinkedPaymentsDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  last4: string;
  brand: string;
  collisionRisk: boolean;
  onComplete: () => void;
}

const LIMIT = 50;

export default function UnlinkedPaymentsDetailDrawer({
  open,
  onOpenChange,
  last4,
  brand,
  collisionRisk,
  onComplete,
}: UnlinkedPaymentsDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [details, setDetails] = useState<UnlinkedPaymentDetail[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (open && last4 && brand) {
      // Reset state on open or card change
      setDetails([]);
      setOffset(0);
      setTotal(0);
      setHasMore(false);
      fetchDetails(true);
    }
  }, [open, last4, brand]);

  const fetchDetails = async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    
    if (reset) {
      setLoading(true);
      setDetails([]);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const { data, error } = await supabase.functions.invoke('admin-unlinked-payments-report', {
        body: { mode: 'details', last4, brand, limit: LIMIT, offset: currentOffset }
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to fetch details');

      const newDetails = data.details || [];
      
      setDetails(prev => reset ? newDetails : [...prev, ...newDetails]);
      setTotal(data.total || 0);
      setHasMore(!!data.pagination?.has_more);
      setOffset(currentOffset + newDetails.length);
    } catch (err: unknown) {
      console.error('Error fetching details:', err);
      const message = err instanceof Error ? err.message : 'Ошибка загрузки';
      toast.error(message);
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  const handleAutolinked = () => {
    toast.success('Привязка выполнена');
    setDetails([]);
    setOffset(0);
    fetchDetails(true);
    onComplete();
  };

  const paymentsV2Count = details.filter(d => d.source === 'payments_v2').length;
  const queueCount = details.filter(d => d.source === 'queue').length;
  const pageAmount = details.reduce((sum, d) => sum + d.amount, 0);

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Непривязанные платежи *{last4} ({brand})
          </SheetTitle>
          <SheetDescription>
            Детальный список транзакций без привязки к контакту
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Honest totals summary */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              Всего: {total}
            </Badge>
            <Badge variant="secondary">
              Загружено: {details.length}
            </Badge>
            <Badge variant="secondary">
              Сумма (загруженные): {formatAmount(pageAmount)} BYN
            </Badge>
            <Badge variant="outline">
              payments_v2: {paymentsV2Count} / queue: {queueCount}
            </Badge>
            {collisionRisk && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Коллизия
              </Badge>
            )}
          </div>

          {/* Collision hard-block: always show button, disabled when collision */}
          {collisionRisk ? (
            <>
              <Button disabled className="w-full gap-2">
                <Link2 className="h-4 w-4" />
                Привязать к контакту
              </Button>
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                <span>
                  <strong>Коллизия:</strong> карта связана с несколькими профилями. 
                  Автопривязка заблокирована.
                </span>
              </div>
            </>
          ) : details.length > 0 ? (
            <AdminAutolinkDialog
              onComplete={handleAutolinked}
              prefillLast4={last4}
              prefillBrand={brand}
              renderTrigger={(onClick) => (
                <Button onClick={onClick} className="w-full gap-2">
                  <Link2 className="h-4 w-4" />
                  Привязать к контакту
                </Button>
              )}
            />
          ) : null}

          {/* Table */}
          <ScrollArea className="h-[calc(100vh-380px)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : details.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Нет непривязанных транзакций
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>UID</TableHead>
                      <TableHead>Дата</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Источник</TableHead>
                      <TableHead>Email/Владелец</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.map((item) => (
                      <TableRow key={`${item.source}-${item.id}`}>
                        <TableCell className="font-mono text-xs">
                          {item.uid?.slice(0, 12) || item.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.paid_at 
                            ? format(new Date(item.paid_at), 'dd.MM.yyyy HH:mm')
                            : '—'
                          }
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatAmount(item.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.status || '—'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={item.source === 'payments_v2' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {item.source === 'payments_v2' ? 'payments' : 'queue'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-32 truncate">
                          {item.customer_email || item.card_holder || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Load more button */}
                {hasMore && (
                  <div className="py-4">
                    <Button 
                      variant="outline" 
                      onClick={() => fetchDetails(false)}
                      disabled={isLoadingMore}
                      className="w-full"
                    >
                      {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Загрузить ещё
                    </Button>
                  </div>
                )}
              </>
            )}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
