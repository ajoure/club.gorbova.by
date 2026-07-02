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
  /** ФИО контакта (или email/phone fallback) для отображения в связке. */
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export interface DealPickerOptions {
  isRefund?: boolean;
  amount?: number;
  currency?: string;
  helperText?: string;
  title?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (deal: PickedDeal) => void;
  options?: DealPickerOptions;
  footerExtras?: React.ReactNode;
  emptyStateExtras?: React.ReactNode;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NUM_RE = /^(ord|rebill|inv|sub|pre)-/i;

function pickContactName(p: any): string | null {
  if (!p) return null;
  return p.full_name || p.email || p.phone || null;
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

  const mapRow = useCallback((o: any): PickedDeal => {
    const snapshot = o.purchase_snapshot;
    const fkName = o.product?.name || o.tariff?.name || null;
    const category = o.product?.category || null;
    const rawName = getDealDisplayName({ productName: fkName, purchaseSnapshot: snapshot, fallback: "" });
    const profile = o.profile;
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
      contact_name: pickContactName(profile),
      contact_email: profile?.email ?? null,
      contact_phone: profile?.phone ?? null,
    };
  }, []);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      const searchTerm = search.trim();
      const isUUID = UUID_RE.test(searchTerm);
      const looksLikeOrderNumber = ORDER_NUM_RE.test(searchTerm) || /^\d/.test(searchTerm);

      const baseSelect = `id, order_number, status, final_price, currency, created_at, profile_id, user_id,
         purchase_snapshot,
         tariff:tariffs(name),
         product:products_v2(name, category),
         profile:profiles!orders_v2_profile_id_fkey(id, full_name, email, phone)`;

      // Branch A: no search / order-number-ish / UUID → search orders directly
      if (!searchTerm || isUUID || looksLikeOrderNumber) {
        let query = supabase
          .from("orders_v2")
          .select(baseSelect)
          .order("created_at", { ascending: false })
          .limit(50);

        if (searchTerm) {
          if (isUUID) query = query.eq("id", searchTerm);
          else query = query.ilike("order_number", `%${searchTerm}%`);
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
        setResults((data || []).map(mapRow));
        return;
      }

      // Branch B: text search — combine order-number ilike + contact search
      const [ordersRes, profilesRes] = await Promise.all([
        supabase
          .from("orders_v2")
          .select(baseSelect)
          .ilike("order_number", `%${searchTerm}%`)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("profiles")
          .select("id")
          .or(
            `full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`,
          )
          .limit(50),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const profileIds = (profilesRes.data ?? []).map((p: any) => p.id);
      let contactOrders: any[] = [];
      if (profileIds.length > 0) {
        let cq = supabase
          .from("orders_v2")
          .select(baseSelect)
          .in("profile_id", profileIds)
          .order("created_at", { ascending: false })
          .limit(50);
        if (isRefund) cq = cq.eq("status", "paid");
        const { data, error } = await cq;
        if (error) throw error;
        contactOrders = data ?? [];
      }

      const merged = new Map<string, any>();
      for (const r of [...(ordersRes.data ?? []), ...contactOrders]) merged.set(r.id, r);
      const list = Array.from(merged.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);
      setResults(list.map(mapRow));
    } catch (e: any) {
      toast.error(`Ошибка поиска: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [search, isRefund, amount, mapRow]);

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
      <DialogContent className="sm:max-w-[580px]">
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
                placeholder="ФИО / email / телефон / номер сделки…"
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

          <ScrollArea className="h-[360px] border rounded-md overflow-auto">
            {results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {loading ? "Поиск..." : emptyStateExtras ?? <p>Нет сделок</p>}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {results.map((order) => {
                  const isSel = selected?.id === order.id;
                  const shortId = order.order_number || order.id.substring(0, 8);
                  return (
                    <button
                      key={order.id}
                      onClick={() => setSelected(order)}
                      className={`w-full text-left p-3 rounded-md transition-colors ${
                        isSel
                          ? "bg-primary/10 border border-primary"
                          : "hover:bg-muted border border-transparent"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {/* Row 1: contact as headline */}
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm truncate">
                              {order.contact_name || "Без контакта"}
                            </span>
                            {order.status && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                {order.status}
                              </Badge>
                            )}
                          </div>
                          {/* Row 2: product, small non-bold */}
                          {order.product_name && (
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                              <ProductCategoryBadge category={order.product_category as any} />
                              <span className="truncate">{order.product_name}</span>
                            </div>
                          )}
                          {/* Row 3: id + date, muted mono tiny */}
                          <div className="text-[11px] text-muted-foreground/80 mt-0.5 font-mono flex items-center gap-2">
                            <span>{shortId}</span>
                            <span>·</span>
                            <span>{format(new Date(order.created_at), "dd.MM.yy", { locale: ru })}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-sm font-medium whitespace-nowrap">
                            {order.final_price} {order.currency}
                          </span>
                          {isSel && <Check className="h-4 w-4 text-primary" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
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
