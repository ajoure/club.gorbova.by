import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User, Mail, Phone, Check, Loader2, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LinkTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    uid: string;
    customer_email?: string;
    customer_name?: string;
    customer_phone?: string;
    amount?: number;
    currency?: string;
    _queue_id?: string;
  } | null;
  onLinked?: (profileId: string) => void;
}

interface ProfileResult {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

export function LinkTransactionDialog({ open, onOpenChange, transaction, onLinked }: LinkTransactionDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ProfileResult | null>(null);
  const [applyToAll, setApplyToAll] = useState(true);
  const queryClient = useQueryClient();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .or(`email.ilike.%${searchQuery}%,full_name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`)
        .limit(20);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (err: any) {
      toast.error("Ошибка поиска: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const linkMutation = useMutation({
    mutationFn: async ({ profileId, email }: { profileId: string; email?: string }) => {
      // Link this transaction in queue
      if (transaction?._queue_id) {
        const { error } = await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: profileId })
          .eq("id", transaction._queue_id);
        if (error) throw error;
      }

      // Also link by bepaid_uid if exists
      if (transaction?.uid) {
        await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: profileId })
          .eq("bepaid_uid", transaction.uid);
      }

      // If applyToAll, link all transactions with same email
      if (applyToAll && email) {
        const { error: updateError } = await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: profileId })
          .eq("customer_email", email)
          .is("matched_profile_id", null);
        
        if (updateError) console.warn("Error updating all by email:", updateError);
      }

      return { profileId };
    },
    onSuccess: ({ profileId }) => {
      toast.success(applyToAll ? "Контакт связан со всеми платежами" : "Контакт связан");
      queryClient.invalidateQueries({ queryKey: ["bepaid-raw-data"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
      onLinked?.(profileId);
      onOpenChange(false);
      setSearchQuery("");
      setSearchResults([]);
      setSelectedProfile(null);
    },
    onError: (error: any) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const handleLink = () => {
    if (!selectedProfile) {
      toast.warning("Выберите контакт");
      return;
    }
    linkMutation.mutate({ 
      profileId: selectedProfile.id, 
      email: transaction?.customer_email 
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Связать с контактом
          </DialogTitle>
          <DialogDescription>
            Найдите и выберите контакт для связывания с транзакцией
          </DialogDescription>
        </DialogHeader>

        {/* Transaction info */}
        {transaction && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
            <div className="font-medium">{transaction.amount} {transaction.currency}</div>
            {transaction.customer_email && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Mail className="h-3 w-3" />
                {transaction.customer_email}
              </div>
            )}
            {transaction.customer_name && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <User className="h-3 w-3" />
                {transaction.customer_name}
              </div>
            )}
            {transaction.customer_phone && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Phone className="h-3 w-3" />
                {transaction.customer_phone}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="space-y-3">
          <Label>Поиск контакта</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Email, имя или телефон..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button 
              variant="secondary" 
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Results */}
        {searchResults.length > 0 && (
          <ScrollArea className="h-[200px] border rounded-lg">
            <div className="p-2 space-y-1">
              {searchResults.map((profile) => (
                <div
                  key={profile.id}
                  className={`p-2 rounded cursor-pointer flex items-center justify-between transition-colors ${
                    selectedProfile?.id === profile.id 
                      ? "bg-primary/10 border border-primary" 
                      : "hover:bg-muted"
                  }`}
                  onClick={() => setSelectedProfile(profile)}
                >
                  <div className="space-y-0.5">
                    <div className="font-medium">{profile.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
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
                  {selectedProfile?.id === profile.id && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {searchResults.length === 0 && searchQuery && !isSearching && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            Контакты не найдены
          </div>
        )}

        {/* Apply to all option */}
        {transaction?.customer_email && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="applyToAll"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="rounded border-input"
            />
            <label htmlFor="applyToAll" className="text-sm text-muted-foreground">
              Применить ко всем платежам с email {transaction.customer_email}
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button 
            onClick={handleLink} 
            disabled={!selectedProfile || linkMutation.isPending}
          >
            {linkMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Связать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
