import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { User, Mail, Phone, Check, Search, Loader2 } from "lucide-react";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface LinkContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  initialEmail?: string | null;
  initialPhone?: string | null;
  onSuccess: () => void;
}

export function LinkContactDialog({ 
  open, 
  onOpenChange, 
  paymentId, 
  rawSource,
  initialEmail,
  initialPhone,
  onSuccess 
}: LinkContactDialogProps) {
  const [search, setSearch] = useState(initialEmail || initialPhone || "");
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Profile | null>(null);

  const handleSearch = async () => {
    if (!search.trim()) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .or(`email.ilike.%${search}%,phone.ilike.%${search}%,full_name.ilike.%${search}%`)
        .limit(20);
      
      if (error) throw error;
      setResults(data || []);
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
          .update({ matched_profile_id: selected.id })
          .eq("id", paymentId);
        
        if (error) throw error;
      } else {
        // For payments_v2, we update via linked order or create a card_profile_link
        // This is a simplified version - in production would need order linkage
        toast.info("Для связи с payments_v2 используйте сделку");
      }
      
      toast.success("Контакт связан");
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
            Связать контакт
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">Поиск</Label>
              <Input
                id="search"
                placeholder="Email, телефон или имя..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          
          <ScrollArea className="h-[250px] border rounded-md">
            {results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {loading ? "Поиск..." : "Введите запрос и нажмите поиск"}
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
                      <div className="text-xs text-muted-foreground flex items-center gap-3">
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