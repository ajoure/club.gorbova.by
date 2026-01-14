import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, Check, Search, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Order {
  id: string;
  order_number: string | null;
  status: string | null;
  total_amount: number;
  currency: string;
  created_at: string;
  product_name: string | null;
}

interface LinkDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  amount?: number;
  onSuccess: () => void;
}

export function LinkDealDialog({ 
  open, 
  onOpenChange, 
  paymentId, 
  rawSource,
  amount,
  onSuccess 
}: LinkDealDialogProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("orders_v2")
        .select(`
          id, order_number, status, total_amount, currency, created_at,
          tariff:tariffs(name),
          product:products_v2(name)
        `)
        .order("created_at", { ascending: false })
        .limit(30);
      
      if (search.trim()) {
        query = query.or(`order_number.ilike.%${search}%`);
      }
      
      // Optionally filter by similar amount
      if (amount && !search.trim()) {
        query = query.gte("total_amount", amount * 0.9).lte("total_amount", amount * 1.1);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      setResults((data || []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        total_amount: o.total_amount,
        currency: o.currency,
        created_at: o.created_at,
        product_name: o.product?.name || o.tariff?.name || null,
      })));
    } catch (e: any) {
      toast.error(`Ошибка поиска: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async () => {
    if (!selected) return;
    
    setSaving(true);
    try {
      if (rawSource === 'queue') {
        const { error } = await supabase
          .from("payment_reconcile_queue")
          .update({ matched_order_id: selected.id })
          .eq("id", paymentId);
        
        if (error) throw error;
      } else {
        // For payments_v2, update order_id directly if allowed
        const { error } = await supabase
          .from("payments_v2")
          .update({ order_id: selected.id })
          .eq("id", paymentId);
        
        if (error) throw error;
      }
      
      toast.success("Сделка связана");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Auto-search on open
  useState(() => {
    if (open) {
      handleSearch();
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Связать сделку
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">Поиск</Label>
              <Input
                id="search"
                placeholder="Номер сделки..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          
          {amount && (
            <p className="text-xs text-muted-foreground">
              Показаны сделки с суммой ≈ {amount} (±10%)
            </p>
          )}
          
          <ScrollArea className="h-[300px] border rounded-md">
            {results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {loading ? "Поиск..." : "Нет сделок"}
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
                          <Badge variant="outline" className="text-xs">
                            {order.status}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {order.total_amount} {order.currency}
                        </span>
                        {selected?.id === order.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                      <span>{format(new Date(order.created_at), "dd.MM.yy", { locale: ru })}</span>
                      {order.product_name && <span>• {order.product_name}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleLink} disabled={!selected || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Связать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}