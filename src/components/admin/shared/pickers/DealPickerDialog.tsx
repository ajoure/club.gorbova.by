import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Layers, Check, Search, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { getDealDisplayName, getShortDisplayName } from "@/lib/deals/getDealDisplayName";
import { ProductCategoryBadge } from "@/components/ui/ProductCategoryBadge";

export interface PickedDeal {
  id: string;
  order_number: string | null;
  status: string | null;
  final_price: number;
  currency: string;
  created_at: string;
  product_name: string | null;
  product_category?: string | null;
  profile_id: string | null;
  user_id: string | null;
}

export interface DealPickerOptions {
  /** Restrict to status=paid and pre-filter by amount ±20% (refund use-case). */
  isRefund?: boolean;
  /** Amount used for ±10% (regular) / ±20% (refund) pre-filter when search is empty. */
  amount?: number;
  /** Display-only currency hint shown next to amount filter helper text. */
  currency?: string;
  /** Optional helper line shown above results. */
  helperText?: string;
  /** Title override. */
  title?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (deal: PickedDeal) => void;
  options?: DealPickerOptions;
  /** Optional slot rendered in dialog footer between Cancel/Pick (e.g. "create new"). */
  footerExtras?: React.ReactNode;
  /** Slot rendered above the result list (e.g. empty-state create button). */
  emptyStateExtras?: React.ReactNode;
}

export function DealPickerDialog({
  open,
  onOpenChange,
  onPick,
  options,
  footerExtras,
  emptyStateExtras,
}: Props) {
  const { isRefund, amount, currency, helperText, title } = options ?? {};
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PickedDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PickedDeal | null>(null);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      const searchTerm = search.trim();
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm);

      let query = supabase
        .from("orders_v2")
        .select(
          `id, order_number, status, final_price, currency, created_at, profile_id, user_id,
           purchase_snapshot,
           tariff:tariffs(name),
           product:products_v2(name, category)`,
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (searchTerm) {
        if (isUUID) {
          query = query.eq("id", searchTerm);
        } else {
          query = query.or(`order_number.ilike.%${searchTerm}%`);
        }
      }

      if (isRefund) {
        query = query.eq("status", "paid");
        if (amount && !searchTerm) {
          query = query.gte("final_price", amount * 0.8).lte("final_price", amount * 1.2);
        }
      } else if (amount && !searchTerm) {
        query = query.gte("final_price", amount * 0.9).lte("final_price", amount * 1.1);
      }

      const { data, error } = await query;
      if (error) throw error;

      setResults(
        (data || []).map((o: any) => {
          const snapshot = o.purchase_snapshot;
          const fkName = o.product?.name || o.tariff?.name || null;
          const category = o.product?.category || null;
          const rawName = getDealDisplayName({ productName: fkName, purchaseSnapshot: snapshot, fallback: "" });
          return {
            id: o.id,
            order_number: o.order_number,
            status: o.status,
            final_price: Number(o.final_price),
            currency: o.currency,
            created_at: o.created_at,
            product_name: getShortDisplayName(rawName, category),
            product_category: category,
            profile_id: o.profile_id,
            user_id: o.user_id,
          } as PickedDeal;
        }),
      );
    } catch (e: any) {
      toast.error(`Ошибка поиска: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [search, isRefund, amount]);

  useEffect(() => {
    if (open && results.length === 0) handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setSearch("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-500" />
            {title ?? "Выбрать сделку"}
          </DialogTitle>
          {helperText ? (
            <p className="text-sm text-muted-foreground mt-1">{helperText}</p>
          ) : null}
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="deal-picker-search" className="sr-only">Поиск</Label>
              <Input
                id="deal-picker-search"
                placeholder="Номер сделки или UUID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {amount ? (
            <p className="text-xs text-muted-foreground">
              Показаны сделки с суммой ≈ {amount} {currency || ""} (±{isRefund ? 20 : 10}%)
            </p>
          ) : null}

          <ScrollArea className="h-[350px] border rounded-md overflow-auto">
            {results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {loading ? "Поиск..." : emptyStateExtras ?? <p>Нет сделок</p>}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {results.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => setSelected(order)}
                    className={`w-full text-left p-3 rounded-md transition-colors ${
                      selected?.id === order.id
                        ? "bg-primary/10 border border-primary"
                        : "hover:bg-muted border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {order.order_number || order.id.substring(0, 8)}
                        </span>
                        {order.status && (
                          <Badge variant="outline" className="text-xs">{order.status}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{order.final_price} {order.currency}</span>
                        {selected?.id === order.id && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                      <span>{format(new Date(order.created_at), "dd.MM.yy", { locale: ru })}</span>
                      {order.product_name && (
                        <span className="flex items-center gap-1">
                          • <ProductCategoryBadge category={order.product_category as any} /> {order.product_name}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          {footerExtras}
          <Button
            onClick={() => {
              if (selected) onPick(selected);
            }}
            disabled={!selected}
          >
            Выбрать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
