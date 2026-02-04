import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { User, Mail, Phone, Check, Search, Loader2, AlertCircle, CreditCard } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
}

interface LinkSubscriptionContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string; // bePaid subscription ID (sbs_*)
  customerEmail?: string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
  onSuccess: () => void;
}

export function LinkSubscriptionContactDialog({ 
  open, 
  onOpenChange, 
  subscriptionId,
  customerEmail,
  cardLast4,
  cardBrand,
  onSuccess 
}: LinkSubscriptionContactDialogProps) {
  const [search, setSearch] = useState(customerEmail || "");
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSearch(customerEmail || "");
      setResults([]);
      setSelected(null);
      setHasSearched(false);
      setSearchError(null);
    }
  }, [open, customerEmail]);

  // Debounced search - auto-search after 500ms of typing (if 2+ chars)
  useEffect(() => {
    if (!open || search.trim().length < 2) return;
    
    const timer = setTimeout(() => {
      handleSearch();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [search, open]);

  const handleSearch = useCallback(async () => {
    const term = search.trim();
    if (!term || term.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    
    setLoading(true);
    setSearchError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('admin-search-profiles', {
        body: { query: term, limit: 30 }
      });

      if (error) throw error;
      if (!data?.success) {
        if (data?.error?.includes('Forbidden')) {
          setSearchError("Недостаточно прав для поиска контактов.");
        }
        throw new Error(data?.error || 'Ошибка поиска');
      }
      
      setResults(data.results || []);
      setHasSearched(true);
    } catch (e: any) {
      console.error('Search error:', e);
      if (!searchError) {
        toast.error(`Ошибка поиска: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [search, searchError]);

  const handleLink = async () => {
    if (!selected) return;
    
    setSaving(true);
    try {
      // 1. Update provider_subscriptions with profile_id and user_id
      const { error: subError } = await supabase
        .from("provider_subscriptions")
        .update({ 
          profile_id: selected.id,
          user_id: selected.user_id 
        })
        .eq("provider_subscription_id", subscriptionId);
      
      if (subError) throw subError;

      // 2. Create card-profile link if we have card data
      if (cardLast4) {
        const { data: existingLink } = await supabase
          .from("card_profile_links")
          .select("id")
          .eq("card_last4", cardLast4)
          .eq("profile_id", selected.id)
          .maybeSingle();

        if (!existingLink) {
          await supabase
            .from("card_profile_links")
            .insert({
              card_last4: cardLast4,
              card_brand: cardBrand || null,
              profile_id: selected.id,
              source: 'subscription_link',
            });
        }
      }
      
      toast.success("Контакт привязан к подписке");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Привязать контакт к подписке
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Subscription ID info */}
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
            Подписка: <code className="font-mono">{subscriptionId}</code>
          </div>

          {/* Search input */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="search" className="sr-only">Поиск</Label>
                <Input
                  id="search"
                  placeholder="ФИО, email или телефон (мин. 2 символа)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  autoFocus
                />
              </div>
              <Button onClick={handleSearch} disabled={loading || search.trim().length < 2}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Поиск автоматически запускается при вводе.
            </p>
          </div>
          
          {/* Error alert */}
          {searchError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          )}
          
          {/* Results */}
          <ScrollArea className="h-[200px] border rounded-md">
            {loading && results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                Поиск...
              </div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {hasSearched 
                  ? "Контакты не найдены. Попробуйте другой запрос."
                  : "Введите запрос для поиска (мин. 2 символа)"}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {results.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => setSelected(profile)}
                    className={`w-full text-left p-2 rounded-md transition-colors flex items-center gap-3 ${
                      selected?.id === profile.id 
                        ? "bg-primary/10 border border-primary" 
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {profile.full_name || "Без имени"}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        {profile.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {profile.email}
                          </span>
                        )}
                        {profile.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {profile.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    {selected?.id === profile.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          
          {/* Result count */}
          {results.length > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              Найдено: {results.length}
            </p>
          )}

          {/* Card auto-linking info */}
          {cardLast4 && selected && (
            <div className="pt-2 border-t">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <CreditCard className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-primary">
                    Автопривязка к карте ****{cardLast4}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Контакт будет связан с картой для будущих платежей
                  </p>
                </div>
              </div>
            </div>
          )}
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
