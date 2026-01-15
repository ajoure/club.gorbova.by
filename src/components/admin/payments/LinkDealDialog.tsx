import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, Check, Search, Loader2, Plus } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CreateDealFromPaymentDialog } from "./CreateDealFromPaymentDialog";

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

interface LinkDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  amount?: number;
  currency?: string;
  paidAt?: string;
  profileId?: string | null;
  transactionType?: string; // For detecting refunds
  onSuccess: () => void;
}

export function LinkDealDialog({ 
  open, 
  onOpenChange, 
  paymentId, 
  rawSource,
  amount,
  currency,
  paidAt,
  profileId,
  transactionType,
  onSuccess 
}: LinkDealDialogProps) {
  const isRefund = transactionType === 'Возврат средств' || transactionType === 'refund';
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [createDealOpen, setCreateDealOpen] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("orders_v2")
        .select(`
          id, order_number, status, final_price, currency, created_at, profile_id, user_id,
          tariff:tariffs(name),
          product:products_v2(name)
        `)
        .order("created_at", { ascending: false })
        .limit(30);
      
      if (search.trim()) {
        query = query.or(`order_number.ilike.%${search}%`);
      }
      
      // For refunds, filter by paid status and similar amount
      if (isRefund) {
        query = query.eq("status", "paid");
        if (amount && !search.trim()) {
          query = query.gte("final_price", amount * 0.8).lte("final_price", amount * 1.2);
        }
      } else if (amount && !search.trim()) {
        // Optionally filter by similar amount for regular payments
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
      if (rawSource === 'queue') {
        // Update queue with matched order and profile
        const updateData: Record<string, any> = { 
          matched_order_id: selected.id 
        };
        if (selected.profile_id) {
          updateData.matched_profile_id = selected.profile_id;
        }
        
        const { error } = await supabase
          .from("payment_reconcile_queue")
          .update(updateData)
          .eq("id", paymentId);
        
        if (error) throw error;
      } else {
        // For payments_v2, update order_id and optionally profile_id/user_id
        const updateData: Record<string, any> = { 
          order_id: selected.id 
        };
        
        // Only update profile_id if the selected deal has one and payment doesn't
        if (selected.profile_id) {
          updateData.profile_id = selected.profile_id;
        }
        if (selected.user_id) {
          updateData.user_id = selected.user_id;
        }
        
        const { error } = await supabase
          .from("payments_v2")
          .update(updateData)
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

  const handleCreateDealSuccess = () => {
    setCreateDealOpen(false);
    onSuccess();
    onOpenChange(false);
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {isRefund ? "Связать возврат со сделкой" : "Связать сделку"}
            </DialogTitle>
            {isRefund && (
              <p className="text-sm text-purple-600 dark:text-purple-400 mt-1">
                Вы привязываете возврат. Будут найдены оплаченные сделки с похожей суммой.
              </p>
            )}
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
                Показаны сделки с суммой ≈ {amount} {currency || ''} (±10%)
              </p>
            )}
            
            <ScrollArea className="h-[300px] border rounded-md">
              {results.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  {loading ? (
                    "Поиск..."
                  ) : (
                    <div className="space-y-3">
                      <p>Нет сделок</p>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="gap-2"
                        onClick={() => setCreateDealOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                        Создать сделку
                      </Button>
                    </div>
                  )}
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
            
            {/* Always show create button at bottom */}
            {results.length > 0 && (
              <div className="flex justify-center">
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={() => setCreateDealOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Создать новую сделку
                </Button>
              </div>
            )}
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
      
      <CreateDealFromPaymentDialog
        open={createDealOpen}
        onOpenChange={setCreateDealOpen}
        paymentId={paymentId}
        rawSource={rawSource}
        amount={amount}
        currency={currency}
        paidAt={paidAt}
        profileId={profileId}
        onSuccess={handleCreateDealSuccess}
      />
    </>
  );
}
