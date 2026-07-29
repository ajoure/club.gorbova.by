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
import { orderStatusRu } from "@/lib/orderStatusLabel";

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
  /** Stage 3R.2: restrict search to a single contact's orders. */
  profileId?: string | null;
  /** Stage 3R.2: 'name_only' → text search matches contact full_name only. */
  contactSearchMode?: "default" | "name_only";
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

interface DealContactRow {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface DealQueryRow {
  id: string;
  order_number: string | null;
  status: string | null;
  final_price: number | string;
  currency: string;
  created_at: string;
  profile_id: string | null;
  user_id: string | null;
  purchase_snapshot: unknown;
  tariff?: { name?: string | null } | null;
  product?: { name?: string | null; category?: string | null } | null;
  profile?: DealContactRow | null;
}

function pickContactName(p: DealContactRow | null | undefined): string | null {
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
  const { isRefund, amount, currency, helperText, title, profileId, contactSearchMode } = options ?? {};
  const scopedByContact = !!profileId;
  const nameOnlyContacts = contactSearchMode === "name_only";
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PickedDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PickedDeal | null>(null);

  const mapRow = useCallback((o: DealQueryRow): PickedDeal => {
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
          .eq("is_deleted", false) // Stage 4R.1: hide soft-deleted orders from picker
          .order("created_at", { ascending: false })
          .limit(50);

        if (searchTerm) {
          if (isUUID) query = query.eq("id", searchTerm);
          else query = query.ilike("order_number", `%${searchTerm}%`);
        }

        // Stage 3R.2: scope by selected contact when provided.
        if (profileId) query = query.eq("profile_id", profileId);

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
      const profileOr = nameOnlyContacts
        ? `full_name.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`
        : `full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`;

      let ordersQ = supabase
        .from("orders_v2")
        .select(baseSelect)
        .eq("is_deleted", false) // Stage 4R.1
        .ilike("order_number", `%${searchTerm}%`)
        .order("created_at", { ascending: false })
        .limit(25);
      if (profileId) ordersQ = ordersQ.eq("profile_id", profileId);

      const [ordersRes, profilesRes] = await Promise.all([
        ordersQ,
        supabase
          .from("profiles")
          .select("id")
          .or(profileOr)
          .limit(50),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (profilesRes.error) throw profilesRes.error;

      let profileIds = (profilesRes.data ?? []).map((p: { id: string }) => p.id);
      if (profileId) profileIds = profileIds.filter((id: string) => id === profileId);

      let contactOrders: DealQueryRow[] = [];
      if (profileIds.length > 0) {
        let cq = supabase
          .from("orders_v2")
          .select(baseSelect)
          .eq("is_deleted", false) // Stage 4R.1
          .in("profile_id", profileIds)
          .order("created_at", { ascending: false })
          .limit(50);
        if (isRefund) cq = cq.eq("status", "paid");
        const { data, error } = await cq;
        if (error) throw error;
        contactOrders = data ?? [];
      }

      const merged = new Map<string, DealQueryRow>();
      for (const r of [...(ordersRes.data ?? []), ...contactOrders]) {
        merged.set(r.id, r as DealQueryRow);
      }
      const list = Array.from(merged.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);
      setResults(list.map(mapRow));
    } catch (e: unknown) {
      toast.error(`Ошибка поиска: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [search, isRefund, amount, mapRow, profileId, nameOnlyContacts]);

  useEffect(() => {
    if (open && results.length === 0) handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced auto-search on typing / when contact scope changes.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      handleSearch();
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, open, profileId]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setSearch("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[580px] flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
            <Layers className="h-5 w-5 shrink-0 text-indigo-500" />
            <span className="min-w-0 break-words">{title ?? "Выбрать сделку"}</span>
          </DialogTitle>
          {helperText ? (
            <p className="text-sm text-muted-foreground mt-1">{helperText}</p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 py-3 sm:py-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="min-w-0">
              <Label htmlFor="deal-picker-search" className="sr-only">Поиск</Label>
              <Input
                id="deal-picker-search"
                placeholder={
                  scopedByContact
                    ? "Номер сделки… (в рамках выбранного контакта)"
                    : nameOnlyContacts
                    ? "Имя контакта / номер сделки…"
                    : "ФИО / email / телефон / номер сделки…"
                }
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

          <ScrollArea className="h-[min(360px,calc(100dvh-15rem))] min-h-[180px] w-full max-w-full overflow-hidden rounded-md border">
            {results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {loading ? "Поиск..." : emptyStateExtras ?? <p>Нет сделок</p>}
              </div>
            ) : (
              <div className="p-2 space-y-1 max-w-full overflow-hidden">
                {results.map((order) => {
                  const isSel = selected?.id === order.id;
                  const shortId = order.order_number || order.id.substring(0, 8);
                  return (
                    <button
                      key={order.id}
                      onClick={() => setSelected(order)}
                      className={`block w-full max-w-full overflow-hidden text-left p-3 rounded-md transition-colors ${
                        isSel
                          ? "bg-primary/10 border border-primary"
                          : "hover:bg-muted border border-transparent"
                      }`}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_88px] sm:grid-cols-[minmax(0,1fr)_104px] gap-3 items-start max-w-full overflow-hidden">
                        <div className="min-w-0 overflow-hidden">
                          {/* Row 1: contact as headline */}
                          <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
                            <span className="min-w-0 truncate font-semibold text-sm">
                              {order.contact_name || "Без контакта"}
                            </span>
                            {order.status && (
                              <Badge variant="outline" className="shrink-0 max-w-[92px] truncate text-[10px] px-1.5 py-0 font-normal">
                                {orderStatusRu(order.status)}
                              </Badge>
                            )}
                          </div>
                          {/* Row 2: product, small non-bold */}
                          {order.product_name && (
                            <div className="min-w-0 max-w-full overflow-hidden text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <ProductCategoryBadge category={order.product_category} />
                              <span className="min-w-0 truncate">{order.product_name}</span>
                            </div>
                          )}
                          {/* Row 3: id + date, muted mono tiny */}
                          <div className="min-w-0 max-w-full overflow-hidden text-[11px] text-muted-foreground/80 mt-0.5 font-mono flex items-center gap-2">
                            <span className="min-w-0 truncate">{shortId}</span>
                            <span>·</span>
                            <span className="shrink-0">{format(new Date(order.created_at), "dd.MM.yy", { locale: ru })}</span>
                          </div>
                        </div>
                        <div className="min-w-0 flex flex-col items-end gap-1 overflow-hidden">
                          <span className="max-w-full truncate text-sm font-medium whitespace-nowrap">
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

        <DialogFooter className="grid grid-cols-1 gap-2 sm:flex sm:space-x-0">
          <Button className="w-full sm:w-auto" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <div className="contents [&>*]:w-full sm:[&>*]:w-auto">{footerExtras}</div>
          <Button
            className="w-full sm:w-auto"
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
