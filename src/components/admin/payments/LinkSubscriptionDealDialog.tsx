import { useState, useEffect } from "react";
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
  final_price: number;
  currency: string;
  created_at: string;
  product_name: string | null;
  profile_id: string | null;
  user_id: string | null;
}

interface LinkSubscriptionDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string; // bePaid subscription ID (sbs_*)
  amount?: number;
  currency?: string;
  profileId?: string | null;
  onSuccess: () => void;
}

export function LinkSubscriptionDealDialog({ 
  open, 
  onOpenChange, 
  subscriptionId,
  amount,
  currency,
  profileId,
  onSuccess 
}: LinkSubscriptionDealDialogProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const searchTerm = search.trim();
      
      // Check if search looks like a UUID
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm);
      
      let query = supabase
        .from("orders_v2")
        .select(`
          id, order_number, status, final_price, currency, created_at, profile_id, user_id,
          tariff:tariffs(name),
          product:products_v2(name)
        `)
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (searchTerm) {
        if (isUUID) {
          query = query.eq("id", searchTerm);
        } else {
          query = query.or(`order_number.ilike.%${searchTerm}%`);
        }
      } else if (amount) {
        // Filter by similar amount (±10%)
        query = query.gte("final_price", amount * 0.9).lte("final_price", amount * 1.1);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      setResults((data || []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        final_price: Number(o.final_price),
        currency: o.currency,
        created_at: o.created_at,
        product_name: o.product?.name || o.tariff?.name || null,
        profile_id: o.profile_id,
        user_id: o.user_id,
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
      // 1. Update orders_v2.meta with bepaid_subscription_id
      // First fetch current meta
      const { data: orderData, error: fetchError } = await supabase
        .from("orders_v2")
        .select("meta")
        .eq("id", selected.id)
        .single();
      
      if (fetchError) throw fetchError;
      
      const currentMeta = (orderData?.meta as Record<string, any>) || {};
      const updatedMeta = {
        ...currentMeta,
        bepaid_subscription_id: subscriptionId,
      };
      
      const { error: orderError } = await supabase
        .from("orders_v2")
        .update({ meta: updatedMeta })
        .eq("id", selected.id);
      
      if (orderError) throw orderError;
      
      // 2. Update provider_subscriptions with profile_id and user_id from order
      if (selected.profile_id || selected.user_id) {
        const updateData: Record<string, any> = {};
        if (selected.profile_id) updateData.profile_id = selected.profile_id;
        if (selected.user_id) updateData.user_id = selected.user_id;
        
        const { error: subError } = await supabase
          .from("provider_subscriptions")
          .update(updateData)
          .eq("provider_subscription_id", subscriptionId);
        
        if (subError) {
          console.warn("Failed to update provider_subscriptions:", subError);
        }
      }
      
      toast.success("Сделка привязана к подписке");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Auto-search on open
  useEffect(() => {
    if (open && results.length === 0) {
      handleSearch();
    }
  }, [open]);

  // Reset state when dialog closes
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
            <Package className="h-5 w-5" />
            Привязать сделку к подписке
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Subscription ID info */}
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
            Подписка: <code className="font-mono">{subscriptionId}</code>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">Поиск</Label>
              <Input
                id="search"
                placeholder="Номер сделки или UUID..."
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
              Показаны сделки с суммой ≈ {amount} {currency || ''} (±10%)
            </p>
          )}
          
          <ScrollArea className="h-[300px] border rounded-md overflow-auto">
            {loading && results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                Поиск...
              </div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                Сделки не найдены
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
                          {order.final_price} {order.currency}
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
            Привязать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
